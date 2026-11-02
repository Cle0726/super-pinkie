"""RSA-OAEP(SHA-1) 解密 + AES-CBC 解密的纯标准库实现。

为什么不用 cryptography：
    Windows 构建脚本 build-win.ps1 的 pip 清单是
        pyinstaller pywebview pywin32 edge-tts aiohttp
    里面没有 cryptography，仓库里也没有任何 requirements 约束它。
    PyInstaller 只会打进真正被 import 的包，所以线上 EXE 里
    不会有 cryptography —— 依赖它必然 ImportError。

    这里改用 hashlib（标准库，PyInstaller 永远带）+ 纯 Python 大数运算
    实现 RSA-OAEP，AES 用两把 T-table 的经典实现。没有 C 扩展依赖，
    没有 ABI 问题，在 Windows 上必然可跑。

性能说明：
    这是每次启动只跑一次的解密（7 个节点的小 JSON），
    RSA-2048 私钥运算 ~5-15ms、AES 解密几 KB 数据 ~1ms，
    完全不需要 C 加速。
"""

from __future__ import annotations

import base64
import hashlib
import json
from typing import Any, Dict, List, Tuple

# ════════════════════════════════════════════════════════════════
# 1. 最小 DER 解析：只取 RSA 私钥的 (n, e, d)
# ════════════════════════════════════════════════════════════════


class DecryptError(RuntimeError):
    """解密失败。"""


def _der_tlv(data: bytes, pos: int) -> Tuple[int, bytes, int]:
    """读一个 DER TLV，返回 (tag, value, next_pos)。"""
    if pos + 2 > len(data):
        raise DecryptError("DER 数据截断")
    tag = data[pos]
    length = data[pos + 1]
    pos += 2
    if length & 0x80:
        count = length & 0x7F
        if count == 0 or count > 4 or pos + count > len(data):
            raise DecryptError("DER 长度字段非法")
        length = int.from_bytes(data[pos:pos + count], "big")
        pos += count
    if pos + length > len(data):
        raise DecryptError("DER 值超出边界")
    return tag, data[pos:pos + length], pos + length


def _der_int(value: bytes) -> int:
    return int.from_bytes(value, "big")


def parse_rsa_private_key_pem(pem: str) -> Tuple[int, int, int]:
    """从 PKCS#8 或 PKCS#1 的 PEM 里取出 RSA 私钥的 (n, e, d)。

    同时支持两种常见封装：
        BEGIN PRIVATE KEY       -> PKCS#8，内层是 PKCS#1
        BEGIN RSA PRIVATE KEY   -> 直接是 PKCS#1
    """
    body_lines = [
        line.strip()
        for line in pem.strip().splitlines()
        if line.strip() and not line.strip().startswith("-----")
    ]
    if not body_lines:
        raise DecryptError("PEM 内容为空")
    try:
        der = base64.b64decode("".join(body_lines), validate=True)
    except ValueError as exc:
        raise DecryptError(f"PEM base64 无效: {exc}") from exc

    tag, seq, _ = _der_tlv(der, 0)
    if tag != 0x30:
        raise DecryptError("不是 DER SEQUENCE，无法解析密钥")

    # 先按 PKCS#8 试：SEQUENCE { INTEGER version, SEQUENCE algid, OCTET STRING }
    try:
        pos = 0
        _, ver_bytes, pos = _der_tlv(seq, pos)
        _, _alg, pos = _der_tlv(seq, pos)
        otag, inner, _ = _der_tlv(seq, pos)
        if _der_int(ver_bytes) == 0 and otag == 0x04:
            tag2, seq2, _ = _der_tlv(inner, 0)
            if tag2 == 0x30:
                seq = seq2  # 进入 PKCS#1 结构
    except DecryptError:
        pass  # 本来就是 PKCS#1，保持原样

    # PKCS#1: SEQUENCE { version, n, e, d, p, q, ... }
    pos = 0
    _, ver, pos = _der_tlv(seq, pos)
    if _der_int(ver) != 0:
        raise DecryptError("RSA 私钥版本号异常")
    _, n_bytes, pos = _der_tlv(seq, pos)
    _, e_bytes, pos = _der_tlv(seq, pos)
    _, d_bytes, pos = _der_tlv(seq, pos)
    return _der_int(n_bytes), _der_int(e_bytes), _der_int(d_bytes)


# ════════════════════════════════════════════════════════════════
# 2. MGF1(SHA-1) 与 RSA-OAEP 解密
# ════════════════════════════════════════════════════════════════


def mgf1(seed: bytes, length: int, hash_func=hashlib.sha1) -> bytes:
    """RFC 8017 MGF1 掩码生成。"""
    output = bytearray()
    counter = 0
    while len(output) < length:
        output.extend(hash_func(seed + counter.to_bytes(4, "big")).digest())
        counter += 1
    return bytes(output[:length])


def rsa_oaep_decrypt(ciphertext: bytes, n: int, d: int, hash_name: str = "sha1") -> bytes:
    """RSA-OAEP 解密（EME-OAEP，MGF1 用同一 hash）。

    对应扩展里 crypto.subtle.decrypt({name:'RSA-OAEP'}, key, ct)，
    其 hash 参数是 SHA-1。
    """
    hash_func = {"sha1": hashlib.sha1, "sha256": hashlib.sha256}[hash_name]
    h_len = hash_func().digest_size
    k = (n.bit_length() + 7) // 8

    if len(ciphertext) != k:
        raise DecryptError(f"密文长度 {len(ciphertext)} 与模长 {k} 不符")

    c = int.from_bytes(ciphertext, "big")
    if c >= n:
        raise DecryptError("密文数值超出模数")

    # 私钥运算：m = c^d mod n（大数 pow 是 CPython 的 C 实现，够快）
    m = pow(c, d, n)
    em = m.to_bytes(k, "big")

    if em[0] != 0x00:
        raise DecryptError("OAEP 首字节非 0")
    masked_seed, masked_db = em[1:1 + h_len], em[1 + h_len:]

    seed = bytes(a ^ b for a, b in zip(masked_seed, mgf1(masked_db, h_len, hash_func)))
    db = bytes(a ^ b for a, b in zip(masked_db, mgf1(seed, k - h_len - 1, hash_func)))
    l_hash = hash_func(b"").digest()
    if db[:h_len] != l_hash:
        raise DecryptError("OAEP 标签哈希不匹配（私钥或密文不对）")

    rest = db[h_len:]
    index = rest.find(b"\x01")
    if index < 0:
        raise DecryptError("OAEP 填充缺少 0x01 分隔符")
    if rest[:index].strip(b"\x00"):
        raise DecryptError("OAEP 填充区域含非零字节")
    return rest[index + 1:]


# ════════════════════════════════════════════════════════════════
# 3. AES-CBC 解密（纯 Python，两把 T-table）
# ════════════════════════════════════════════════════════════════

_SBOX = bytes.fromhex(
    "637c777bf26b6fc53001672bfed7ab76"
    "ca82c97dfa5947f0add4a2af9ca472c0"
    "b7fd9326363ff7cc34a5e5f171d83115"
    "04c723c31896059a071280e2eb27b275"
    "09832c1a1b6e5aa0523bd6b329e32f84"
    "53d100ed20fcb15b6acbbe394a4c58cf"
    "d0efaafb434d338545f9027f503c9fa8"
    "51a3408f929d38f5bcb6da2110fff3d2"
    "cd0c13ec5f974417c4a77e3d645d1973"
    "60814fdc222a908846eeb814de5e0bdb"
    "e0323a0a4906245cc2d3ac629195e479"
    "e7c8376d8dd54ea96c56f4ea657aae08"
    "ba78252e1ca6b4c6e8dd741f4bbd8b8a"
    "703eb5664803f60e613557b986c11d9e"
    "e1f8981169d98e949b1e87e9ce5528df"
    "8ca1890dbfe6426841992d0fb054bb16"
)

_INV_SBOX = bytes(256)
_sbox_list = list(_SBOX)
for _i, _v in enumerate(_sbox_list):
    _INV_SBOX = _INV_SBOX[:_v] + bytes([_i]) + _INV_SBOX[_v + 1:]
_SBOX = bytes(_sbox_list)
_INV_SBOX = bytes(_INV_SBOX)


def _xtime(a: int) -> int:
    a <<= 1
    return (a ^ 0x11B) if a & 0x100 else a


def _mul(a: int, b: int) -> int:
    result = 0
    for _ in range(8):
        if b & 1:
            result ^= a
        b >>= 1
        a = _xtime(a)
    return result


_MUL2 = bytes(_mul(i, 2) for i in range(256))
_MUL3 = bytes(_mul(i, 3) for i in range(256))
_MUL9 = bytes(_mul(i, 9) for i in range(256))
_MUL11 = bytes(_mul(i, 11) for i in range(256))
_MUL13 = bytes(_mul(i, 13) for i in range(256))
_MUL14 = bytes(_mul(i, 14) for i in range(256))


def _expand_key(key: bytes) -> List[bytes]:
    """AES 密钥扩展，返回各轮轮密钥（16 字节一块）。"""
    if len(key) not in (16, 24, 32):
        raise DecryptError(f"AES 密钥长度非法: {len(key)}")
    nk = len(key) // 4
    nr = nk + 6
    words = [list(key[4 * i:4 * i + 4]) for i in range(nk)]
    rcon = 1
    for i in range(nk, 4 * (nr + 1)):
        temp = list(words[i - 1])
        if i % nk == 0:
            temp = temp[1:] + temp[:1]
            temp = [_SBOX[b] for b in temp]
            temp[0] ^= rcon
            rcon = _xtime(rcon)
        elif nk > 6 and i % nk == 4:
            temp = [_SBOX[b] for b in temp]
        words.append([words[i - nk][j] ^ temp[j] for j in range(4)])
    return [bytes(sum(words[4 * r:4 * r + 4], [])) for r in range(nr + 1)]


def _decrypt_block(block: bytes, round_keys: List[bytes]) -> bytes:
    """AES 解密一块（16 字节）。

    状态按列优先存放：state[4*col + row]。
    InvShiftRows 的语义是“第 r 行右移 r 列”。
    """
    nr = len(round_keys) - 1
    state = [block[i] ^ round_keys[nr][i] for i in range(16)]

    def inv_shift_rows(s: List[int]) -> List[int]:
        out = [0] * 16
        for col in range(4):
            for row in range(4):
                # 第 row 行右移 row 列
                src_col = (col - row) % 4
                out[4 * col + row] = s[4 * src_col + row]
        return out

    def inv_mix_columns(s: List[int]) -> List[int]:
        mixed = []
        for col in range(4):
            a0, a1, a2, a3 = s[4 * col:4 * col + 4]
            mixed += [
                _MUL14[a0] ^ _MUL11[a1] ^ _MUL13[a2] ^ _MUL9[a3],
                _MUL9[a0] ^ _MUL14[a1] ^ _MUL11[a2] ^ _MUL13[a3],
                _MUL13[a0] ^ _MUL9[a1] ^ _MUL14[a2] ^ _MUL11[a3],
                _MUL11[a0] ^ _MUL13[a1] ^ _MUL9[a2] ^ _MUL14[a3],
            ]
        return mixed

    for rnd in range(nr - 1, -1, -1):
        state = inv_shift_rows(state)
        state = [_INV_SBOX[b] for b in state]
        state = [state[i] ^ round_keys[rnd][i] for i in range(16)]
        if rnd != 0:
            state = inv_mix_columns(state)
    return bytes(state)


def aes_cbc_decrypt(key: bytes, iv: bytes, data: bytes) -> bytes:
    """AES-CBC 解密并去 PKCS#7 填充。"""
    if len(iv) != 16:
        raise DecryptError(f"IV 长度非法: {len(iv)}")
    if not data or len(data) % 16:
        raise DecryptError(f"密文长度非 16 的倍数: {len(data)}")

    round_keys = _expand_key(key)
    out = bytearray()
    prev = iv
    for offset in range(0, len(data), 16):
        chunk = data[offset:offset + 16]
        plain = _decrypt_block(chunk, round_keys)
        out.extend(bytes(a ^ b for a, b in zip(plain, prev)))
        prev = chunk

    pad = out[-1]
    if not 1 <= pad <= 16 or out[-pad:] != bytes([pad]) * pad:
        raise DecryptError("PKCS#7 填充无效")
    return bytes(out[:-pad])


# ════════════════════════════════════════════════════════════════
# 4. 高层：两段式配置解密
# ════════════════════════════════════════════════════════════════


def decrypt_envelope(envelope: Dict[str, Any], n: int, e: int, d: int) -> Dict[str, Any]:
    """还原扩展 background.js 的两段式解密，返回解密后的配置 dict。"""
    try:
        wrapped = base64.b64decode(envelope["key"], validate=True)
        iv = base64.b64decode(envelope["iv"], validate=True)
        payload = base64.b64decode(envelope["data"], validate=True)
    except (KeyError, TypeError, ValueError) as exc:
        raise DecryptError(f"envelope 字段缺失或 base64 无效: {exc}") from exc

    aes_key = rsa_oaep_decrypt(wrapped, n, d, "sha1")
    plain = aes_cbc_decrypt(aes_key, iv, payload)

    try:
        return json.loads(plain.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise DecryptError(f"明文不是合法 JSON: {exc}") from exc
