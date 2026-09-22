import os
import base64
import shutil

src = 'tv_frontend/public/charting_library'
dst = 'tv_frontend/public/data_pack'

if os.path.exists(dst):
    shutil.rmtree(dst)
shutil.copytree(src, dst)

for root, dirs, files in os.walk(dst):
    for f in files:
        if f.endswith('.d.ts') or f == 'package.json' or f == 'sameorigin.html':
            os.remove(os.path.join(root, f))

for root, dirs, files in os.walk(dst):
    for f in files:
        if f.endswith('.js'):
            filepath = os.path.join(root, f)
            with open(filepath, 'rb') as fp:
                data = fp.read()
            encoded = base64.b64encode(data)
            txt_filepath = filepath[:-3] + '.txt'
            with open(txt_filepath, 'wb') as fp:
                fp.write(encoded)
            os.remove(filepath)
print("Obfuscation complete!")
