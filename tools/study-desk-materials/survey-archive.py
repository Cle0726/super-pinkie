#!/usr/bin/env python3
"""Read-only archive metadata. Never extracts a member or writes beside the source."""
import ctypes
import ctypes.util
import json
import posixpath
import sys
import zipfile
from xml.etree import ElementTree as ET

MAX_XML = 8 * 1024 * 1024

def zip_name(info):
    if info.flag_bits & 0x800:
        return info.filename
    raw = info.filename.encode('cp437')
    for codec in ('utf-8', 'gbk', 'cp437'):
        try:
            return raw.decode(codec)
        except UnicodeError:
            pass
    return info.filename

def xml(z, name):
    entry = z.getinfo(name)
    if entry.file_size > MAX_XML:
        raise ValueError('XML member exceeds 8 MiB')
    return ET.fromstring(z.read(entry))

def inspect_zip(file, mode):
    with zipfile.ZipFile(file) as z:
        if mode == 'pptx':
            ns = {'p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
                  'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
            rels = {r.attrib['Id']: r.attrib.get('Target', '') for r in xml(z, 'ppt/_rels/presentation.xml.rels')}
            pages = []
            for node in xml(z, 'ppt/presentation.xml').findall('.//p:sldId', ns):
                target = rels[node.attrib['{' + ns['r'] + '}id']]
                member = target.lstrip('/') if target.startswith('/') else posixpath.normpath(posixpath.join('ppt', target))
                page = xml(z, member)
                texts = [e.text or '' for e in page.iter() if e.tag.endswith('}t')]
                notes_chars = 0
                rel_path = posixpath.join(posixpath.dirname(member), '_rels', posixpath.basename(member) + '.rels')
                if rel_path in z.namelist():
                    for rel in xml(z, rel_path):
                        if rel.attrib.get('Type', '').endswith('/notesSlide'):
                            note = posixpath.normpath(posixpath.join(posixpath.dirname(member), rel.attrib['Target']))
                            notes_chars += sum(len(''.join((e.text or '').split())) for e in xml(z, note).iter() if e.tag.endswith('}t'))
                pages.append({'n': len(pages)+1, 'chars': len(''.join(''.join(texts).split())), 'notesChars': notes_chars})
            return {'slides': len(pages), 'withText': sum(p['chars'] > 0 for p in pages), 'pages': pages}
        members = [{'path': zip_name(i), 'size': i.file_size, 'compressedBytes': i.compress_size,
                    'encrypted': bool(i.flag_bits & 1), 'directory': i.is_dir()} for i in z.infolist()]
        return {'members': members, 'encrypted': any(i['encrypted'] for i in members)}

def inspect_rar(file):
    lib = ctypes.CDLL(ctypes.util.find_library('archive') or '/usr/lib/libarchive.2.dylib')
    def fn(name, restype, argtypes):
        f = getattr(lib, name); f.restype = restype; f.argtypes = argtypes; return f
    ptr = ctypes.c_void_p
    new = fn('archive_read_new', ptr, [])
    support = fn('archive_read_support_format_all', ctypes.c_int, [ptr])
    filters = fn('archive_read_support_filter_all', ctypes.c_int, [ptr])
    opening = fn('archive_read_open_filename', ctypes.c_int, [ptr, ctypes.c_char_p, ctypes.c_size_t])
    header = fn('archive_read_next_header', ctypes.c_int, [ptr, ctypes.POINTER(ptr)])
    pathname = fn('archive_entry_pathname', ctypes.c_char_p, [ptr])
    size = fn('archive_entry_size', ctypes.c_longlong, [ptr])
    encrypted = fn('archive_entry_is_encrypted', ctypes.c_int, [ptr])
    has_encrypted = fn('archive_read_has_encrypted_entries', ctypes.c_int, [ptr])
    error = fn('archive_error_string', ctypes.c_char_p, [ptr])
    free = fn('archive_read_free', ctypes.c_int, [ptr])
    reader = new(); entry = ptr(); members = []; errors = []
    try:
        support(reader); filters(reader)
        if opening(reader, file.encode(), 10240) < 0:
            raise ValueError((error(reader) or b'archive open failed').decode('utf-8', 'replace'))
        for _ in range(100000):
            status = header(reader, ctypes.byref(entry))
            if status == 1: break
            if status < -20:
                errors.append((error(reader) or b'archive header error').decode('utf-8', 'replace')); break
            raw = pathname(entry) or b''
            try: name = raw.decode('utf-8')
            except UnicodeError: name = raw.decode('gbk', 'replace')
            members.append({'path': name, 'size': size(entry), 'encrypted': encrypted(entry) > 0, 'directory': name.endswith('/')})
        flag = has_encrypted(reader)
        return {'members': members, 'encrypted': flag > 0 or any(m['encrypted'] for m in members),
                'encryptionKnown': flag >= 0, 'errors': errors}
    finally:
        free(reader)

try:
    mode, file = sys.argv[1:3]
    result = inspect_rar(file) if mode == 'rar' else inspect_zip(file, mode)
    print(json.dumps(result, ensure_ascii=False))
except Exception as error:
    print(json.dumps({'error': str(error)}, ensure_ascii=False))
    sys.exit(1)
