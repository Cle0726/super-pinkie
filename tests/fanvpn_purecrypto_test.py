"""app/fanvpn/purecrypto.py 的纯逻辑单测。

只用标准库：测试里用固定种子生成 RSA 密钥、手工编码 DER/PEM、自己做 OAEP
加密与 AES-CBC 加密，再交给被测模块解密。AES 先用 FIPS-197 与
SP 800-38A 的公开向量钉住，避免「测试侧加密」和「被测解密」错在同一处而互相印证。
不联网、不读用户目录、不依赖 cryptography。
"""

import base64
import hashlib
import json
import math
import random
import sys
import unittest
from pathlib import Path

FANVPN = Path(__file__).resolve().parents[1] / "app" / "fanvpn"
if str(FANVPN) not in sys.path:
    sys.path.append(str(FANVPN))
import purecrypto as pc  # noqa: E402
from purecrypto import DecryptError  # noqa: E402


def _xor(a, b):
    return bytes(x ^ y for x, y in zip(a, b))


def _b64(raw):
    return base64.b64encode(raw).decode("ascii")


# ── 测试侧 RSA：固定种子，结果每次一样 ─────────────────────────────
_SMALL_PRIMES = (2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47)


def _is_probable_prime(n, rng):
    for p in _SMALL_PRIMES:
        if n % p == 0:
            return n == p
    d, s = n - 1, 0
    while d % 2 == 0:
        d //= 2
        s += 1
    for _ in range(24):
        x = pow(rng.randrange(2, n - 1), d, n)
        if x in (1, n - 1):
            continue
        for _ in range(s - 1):
            x = pow(x, 2, n)
            if x == n - 1:
                break
        else:
            return False
    return True


def _make_key(seed, bits=1024):
    """最高两位置 1，保证 n 恰好 bits 位（模长 k = bits/8）。"""
    rng = random.Random(seed)

    def prime():
        while True:
            cand = rng.getrandbits(bits // 2) | (3 << (bits // 2 - 2)) | 1
            if _is_probable_prime(cand, rng):
                return cand

    e = 65537
    while True:
        p, q = prime(), prime()
        phi = (p - 1) * (q - 1)
        if p != q and math.gcd(e, phi) == 1:
            return {"n": p * q, "e": e, "d": pow(e, -1, phi), "p": p, "q": q}


def _der(tag, body):
    n = len(body)
    if n < 0x80:
        head = bytes([n])
    else:
        raw = n.to_bytes((n.bit_length() + 7) // 8, "big")
        head = bytes([0x80 | len(raw)]) + raw
    return bytes([tag]) + head + body


def _der_uint(v):
    raw = v.to_bytes(max(1, (v.bit_length() + 7) // 8), "big")
    return _der(0x02, (b"\x00" + raw) if raw[0] & 0x80 else raw)


def _pkcs1_der(key, version=0):
    p, q, d = key["p"], key["q"], key["d"]
    fields = [version, key["n"], key["e"], d, p, q, d % (p - 1), d % (q - 1), pow(q, -1, p)]
    return _der(0x30, b"".join(_der_uint(f) for f in fields))


def _pkcs8_der(key):
    alg = _der(0x30, _der(0x06, bytes.fromhex("2a864886f70d010101")) + b"\x05\x00")
    return _der(0x30, _der_uint(0) + alg + _der(0x04, _pkcs1_der(key)))


def _pem(der, label, newline="\n"):
    b64 = _b64(der)
    lines = [f"-----BEGIN {label}-----"] + [b64[i:i + 64] for i in range(0, len(b64), 64)]
    return newline.join(lines + [f"-----END {label}-----"]) + newline


def _k(key):
    return (key["n"].bit_length() + 7) // 8


def _raw_rsa(em, key):
    return pow(int.from_bytes(em, "big"), key["e"], key["n"]).to_bytes(_k(key), "big")


def _oaep_from_db(db, key, hash_func=hashlib.sha1):
    """按 RFC 8017 给定 DB 做掩码并加密；单独拆出来是为了能构造畸形 DB。"""
    h_len = hash_func().digest_size
    seed = bytes(range(1, h_len + 1))
    masked_db = _xor(db, pc.mgf1(seed, _k(key) - h_len - 1, hash_func))
    masked_seed = _xor(seed, pc.mgf1(masked_db, h_len, hash_func))
    return _raw_rsa(b"\x00" + masked_seed + masked_db, key)


def _oaep_encrypt(msg, key, hash_func=hashlib.sha1, label=b""):
    h_len = hash_func().digest_size
    ps = b"\x00" * (_k(key) - len(msg) - 2 * h_len - 2)
    return _oaep_from_db(hash_func(label).digest() + ps + b"\x01" + msg, key, hash_func)


# ── 测试侧 AES 加密（用模块的 S 盒与乘法表，正反两向都用公开向量核对）────
def _encrypt_block(block, round_keys):
    nr = len(round_keys) - 1
    s = _xor(block, round_keys[0])
    for rnd in range(1, nr + 1):
        s = [pc._SBOX[b] for b in s]
        # ShiftRows：第 row 行左移 row 列；状态按列优先存放
        s = [s[4 * ((col + row) % 4) + row] for col in range(4) for row in range(4)]
        if rnd != nr:
            mixed = []
            for col in range(4):
                a0, a1, a2, a3 = s[4 * col:4 * col + 4]
                m2, m3 = pc._MUL2, pc._MUL3
                mixed += [m2[a0] ^ m3[a1] ^ a2 ^ a3, a0 ^ m2[a1] ^ m3[a2] ^ a3,
                          a0 ^ a1 ^ m2[a2] ^ m3[a3], m3[a0] ^ a1 ^ a2 ^ m2[a3]]
            s = mixed
        s = _xor(s, round_keys[rnd])
    return bytes(s)


def _aes_cbc_encrypt(key, iv, plain):
    pad = 16 - len(plain) % 16
    data = plain + bytes([pad]) * pad
    round_keys, prev, out = pc._expand_key(key), iv, b""
    for i in range(0, len(data), 16):
        prev = _encrypt_block(_xor(data[i:i + 16], prev), round_keys)
        out += prev
    return out


# FIPS-197 附录 C：明文 00112233...ff，密钥 000102...
FIPS_PLAIN = bytes.fromhex("00112233445566778899aabbccddeeff")
FIPS_VECTORS = {
    16: "69c4e0d86a7b0430d8cdb78070b4c55a",
    24: "dda97ca4864cdfe06eaf70a0ec0d7191",
    32: "8ea2b7ca516745bfeafc49904b496089",
}
# SP 800-38A F.2.1 CBC-AES128
SP_KEY = bytes.fromhex("2b7e151628aed2a6abf7158809cf4f3c")
SP_IV = bytes.fromhex("000102030405060708090a0b0c0d0e0f")
SP_PLAIN = bytes.fromhex(
    "6bc1bee22e409f96e93d7e117393172a" "ae2d8a571e03ac9c9eb76fac45af8e51"
    "30c81c46a35ce411e5fbc1191a0a52ef" "f69f2445df4f9b17ad2b417be66c3710")
SP_CIPHER = bytes.fromhex(
    "7649abac8119b246cee98e9b12e9197d" "5086cb9b507219ee95db113a917678b2"
    "73bed6b8e3c1743b7116e69e22229516" "3ff1caa1681fac09120eca307586e1a7")


class AesTest(unittest.TestCase):
    def test_inverse_sbox_is_exact_inverse(self):
        self.assertEqual(sorted(pc._SBOX), list(range(256)))
        self.assertTrue(all(pc._INV_SBOX[pc._SBOX[i]] == i for i in range(256)))

    def test_key_expansion_matches_fips197_appendix_a(self):
        round_keys = pc._expand_key(SP_KEY)
        self.assertEqual(len(round_keys), 11)
        self.assertEqual(round_keys[0], SP_KEY)
        self.assertEqual(round_keys[-1].hex(), "d014f9a8c9ee2589e13f0cc8b6630ca6")
        self.assertEqual(len(pc._expand_key(bytes(24))), 13)
        self.assertEqual(len(pc._expand_key(bytes(32))), 15)

    def test_block_known_answers_for_all_key_sizes(self):
        for size, cipher_hex in FIPS_VECTORS.items():
            with self.subTest(size=size):
                round_keys = pc._expand_key(bytes(range(size)))
                cipher = bytes.fromhex(cipher_hex)
                self.assertEqual(pc._decrypt_block(cipher, round_keys), FIPS_PLAIN)
                self.assertEqual(_encrypt_block(FIPS_PLAIN, round_keys), cipher)

    def test_cbc_chaining_matches_sp800_38a(self):
        round_keys, prev, out = pc._expand_key(SP_KEY), SP_IV, b""
        for i in range(0, len(SP_CIPHER), 16):
            out += _xor(pc._decrypt_block(SP_CIPHER[i:i + 16], round_keys), prev)
            prev = SP_CIPHER[i:i + 16]
        self.assertEqual(out, SP_PLAIN)
        self.assertEqual(_aes_cbc_encrypt(SP_KEY, SP_IV, SP_PLAIN)[:64], SP_CIPHER)
        # 这 64 字节末字节是 0x10 但前 15 字节不是，必须判成填充无效
        with self.assertRaisesRegex(DecryptError, "PKCS#7"):
            pc.aes_cbc_decrypt(SP_KEY, SP_IV, SP_CIPHER)

    def test_cbc_roundtrip_all_lengths_and_key_sizes(self):
        iv = bytes(range(100, 116))
        for size in (16, 24, 32):
            key = bytes(range(7, 7 + size))
            for length in range(0, 41):
                plain = bytes((i * 37 + length) % 256 for i in range(length))
                with self.subTest(size=size, length=length):
                    data = _aes_cbc_encrypt(key, iv, plain)
                    self.assertEqual(pc.aes_cbc_decrypt(key, iv, data), plain)

    def _single_block(self, wanted_plain):
        """用 FIPS 向量构造单块密文：D(C) 已知，调 IV 让明文恰为 wanted_plain。"""
        return bytes(range(16)), _xor(FIPS_PLAIN, wanted_plain), bytes.fromhex(FIPS_VECTORS[16])

    def test_padding_accepts_every_valid_length(self):
        for pad in range(1, 17):
            body = bytes(range(65, 65 + 16 - pad))
            key, iv, data = self._single_block(body + bytes([pad]) * pad)
            self.assertEqual(pc.aes_cbc_decrypt(key, iv, data), body)

    def test_padding_rejects_bad_bytes(self):
        bad_blocks = {
            "填充 0": bytes(15) + b"\x00",
            "填充 17": bytes(15) + b"\x11",
            "填充字节不一致": bytes(13) + b"\x01\x03\x03",
        }
        for why, block in bad_blocks.items():
            with self.subTest(why=why):
                key, iv, data = self._single_block(block)
                with self.assertRaisesRegex(DecryptError, "PKCS#7"):
                    pc.aes_cbc_decrypt(key, iv, data)

    def test_argument_validation(self):
        with self.assertRaisesRegex(DecryptError, "AES 密钥长度"):
            pc.aes_cbc_decrypt(bytes(15), bytes(16), bytes(16))
        with self.assertRaisesRegex(DecryptError, "IV 长度"):
            pc.aes_cbc_decrypt(bytes(16), bytes(8), bytes(16))
        for data in (b"", bytes(17)):
            with self.assertRaisesRegex(DecryptError, "16 的倍数"):
                pc.aes_cbc_decrypt(bytes(16), bytes(16), data)


class KeyedCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.key = _make_key(20261126)


class Mgf1AndOaepTest(KeyedCase):
    def test_mgf1_known_vectors(self):
        self.assertEqual(pc.mgf1(b"foo", 3).hex(), "1ac907")
        self.assertEqual(pc.mgf1(b"foo", 5).hex(), "1ac9075cd4")
        self.assertEqual(pc.mgf1(b"bar", 5).hex(), "bc0c655e01")
        self.assertEqual(pc.mgf1(b"bar", 0), b"")
        expected = hashlib.sha256(b"bar\x00\x00\x00\x00").digest() + hashlib.sha256(b"bar\x00\x00\x00\x01").digest()
        self.assertEqual(pc.mgf1(b"bar", 50, hashlib.sha256), expected[:50])

    def test_oaep_roundtrip_sha1_and_sha256(self):
        n, d = self.key["n"], self.key["d"]
        for name, func in (("sha1", hashlib.sha1), ("sha256", hashlib.sha256)):
            longest = _k(self.key) - 2 * func().digest_size - 2
            for msg in (b"", bytes(range(32)), b"\x01" * longest):
                with self.subTest(hash=name, length=len(msg)):
                    self.assertEqual(pc.rsa_oaep_decrypt(_oaep_encrypt(msg, self.key, func), n, d, name), msg)

    def test_rejects_wrong_length_and_out_of_range(self):
        n, d, k = self.key["n"], self.key["d"], _k(self.key)
        with self.assertRaisesRegex(DecryptError, "与模长"):
            pc.rsa_oaep_decrypt(bytes(k - 1), n, d)
        with self.assertRaisesRegex(DecryptError, "超出模数"):
            pc.rsa_oaep_decrypt(n.to_bytes(k, "big"), n, d)

    def test_rejects_nonzero_first_byte(self):
        em = b"\x01" + bytes(_k(self.key) - 1)  # n 最高两位为 1，所以 em < n
        with self.assertRaisesRegex(DecryptError, "首字节"):
            pc.rsa_oaep_decrypt(_raw_rsa(em, self.key), self.key["n"], self.key["d"])

    def test_rejects_label_mismatch_and_wrong_key(self):
        n, d = self.key["n"], self.key["d"]
        with self.assertRaisesRegex(DecryptError, "标签哈希"):
            pc.rsa_oaep_decrypt(_oaep_encrypt(b"k" * 32, self.key, label=b"other"), n, d)
        # 换钥后 EM 近似随机：可能先撞上「首字节」「超出模数」或「标签哈希」，
        # 哪一条都行，关键是必须报 DecryptError 而不是吐出垃圾明文
        other = _make_key(7)
        with self.assertRaises(DecryptError):
            pc.rsa_oaep_decrypt(_oaep_encrypt(b"k" * 32, self.key), other["n"], other["d"])

    def test_rejects_malformed_padding_string(self):
        n, d, h = self.key["n"], self.key["d"], hashlib.sha1(b"").digest()
        rest_len = _k(self.key) - 2 * 20 - 1
        no_separator = h + bytes(rest_len)
        with self.assertRaisesRegex(DecryptError, "0x01"):
            pc.rsa_oaep_decrypt(_oaep_from_db(no_separator, self.key), n, d)
        dirty = h + b"\x00\x07" + bytes(rest_len - 4) + b"\x01Z"
        with self.assertRaisesRegex(DecryptError, "非零"):
            pc.rsa_oaep_decrypt(_oaep_from_db(dirty, self.key), n, d)


class PemParseTest(KeyedCase):
    def test_pkcs1_and_pkcs8_give_same_numbers(self):
        expected = (self.key["n"], self.key["e"], self.key["d"])
        pkcs1 = _pem(_pkcs1_der(self.key), "RSA PRIVATE KEY")
        pkcs8 = _pem(_pkcs8_der(self.key), "PRIVATE KEY")
        self.assertEqual(pc.parse_rsa_private_key_pem(pkcs1), expected)
        self.assertEqual(pc.parse_rsa_private_key_pem(pkcs8), expected)
        # 扩展里的 PEM 常带 CRLF、前后空行和缩进
        messy = "\n\n" + "\n".join("    " + line for line in _pem(_pkcs8_der(self.key), "PRIVATE KEY", "\r\n").splitlines())
        self.assertEqual(pc.parse_rsa_private_key_pem(messy), expected)

    def test_rejects_empty_and_invalid_base64(self):
        # 头尾行用拼接写出，避免整段被当成真实私钥扫描
        begin, end = "-----BEGIN " + "PRIVATE KEY-----", "-----END " + "PRIVATE KEY-----"
        with self.assertRaisesRegex(DecryptError, "为空"):
            pc.parse_rsa_private_key_pem(f"{begin}\n\n   \n{end}\n")
        with self.assertRaisesRegex(DecryptError, "base64"):
            pc.parse_rsa_private_key_pem(f"{begin}\n@@@@\n{end}\n")

    def test_rejects_non_sequence_and_bad_version(self):
        with self.assertRaisesRegex(DecryptError, "SEQUENCE"):
            pc.parse_rsa_private_key_pem(_pem(_der_uint(5), "PRIVATE KEY"))
        with self.assertRaisesRegex(DecryptError, "版本号"):
            pc.parse_rsa_private_key_pem(_pem(_pkcs1_der(self.key, version=1), "RSA PRIVATE KEY"))

    def test_rejects_truncated_der(self):
        der = _pkcs1_der(self.key)
        with self.assertRaises(DecryptError):
            pc.parse_rsa_private_key_pem(_pem(der[:len(der) // 2], "RSA PRIVATE KEY"))

    def test_der_tlv_length_forms(self):
        self.assertEqual(pc._der_tlv(b"\x04\x03abcZ", 0), (4, b"abc", 5))
        self.assertEqual(pc._der_tlv(b"\x04\x81\x03abc", 0), (4, b"abc", 6))
        self.assertEqual(pc._der_tlv(b"..\x02\x01\x07", 2), (2, b"\x07", 5))
        for bad in (b"\x04", b"\x04\x80", b"\x04\x85\x00\x00\x00\x00\x01x", b"\x04\x82\x01", b"\x04\x05ab"):
            with self.subTest(bad=bad), self.assertRaises(DecryptError):
                pc._der_tlv(bad, 0)


class EnvelopeTest(KeyedCase):
    AES_KEY = bytes(range(32))
    IV = bytes(range(16, 32))

    def _envelope(self, plain):
        return {
            "key": _b64(_oaep_encrypt(self.AES_KEY, self.key)),
            "iv": _b64(self.IV),
            "data": _b64(_aes_cbc_encrypt(self.AES_KEY, self.IV, plain)),
        }

    def _open(self, envelope):
        return pc.decrypt_envelope(envelope, self.key["n"], self.key["e"], self.key["d"])

    def test_roundtrip_with_chinese_json(self):
        config = {"nodes": [{"name": "美国 1", "server": "us.example.com", "port": 443, "flag": "US"}]}
        plain = json.dumps(config, ensure_ascii=False).encode("utf-8")
        self.assertEqual(self._open(self._envelope(plain)), config)

    def test_missing_or_bad_fields(self):
        good = self._envelope(b"{}")
        for name in ("key", "iv", "data"):
            with self.subTest(missing=name):
                broken = dict(good)
                del broken[name]
                with self.assertRaisesRegex(DecryptError, "envelope"):
                    self._open(broken)
            with self.subTest(bad_base64=name):
                with self.assertRaisesRegex(DecryptError, "envelope"):
                    self._open(dict(good, **{name: "不是base64!"}))
        with self.assertRaisesRegex(DecryptError, "envelope"):
            self._open(dict(good, iv=None))

    def test_plaintext_must_be_utf8_json(self):
        with self.assertRaisesRegex(DecryptError, "JSON"):
            self._open(self._envelope(b"not json"))
        with self.assertRaisesRegex(DecryptError, "JSON"):
            self._open(self._envelope(b"\xff\xfe{}"))

    def test_wrong_session_key_fails_cleanly(self):
        envelope = self._envelope(b'{"a": 1}')
        envelope["key"] = _b64(_oaep_encrypt(bytes(32), self.key))
        with self.assertRaises(DecryptError):
            self._open(envelope)


if __name__ == "__main__":
    unittest.main(verbosity=2)
