import os
import shutil

dst = 'tv_frontend/public/chart_engine'
if os.path.exists(dst):
    shutil.rmtree(dst)
os.makedirs(dst)

orig_src = 'all_charting_libraries/v32.1.0/chanlun-pro-master/charting_library'
shutil.copytree(orig_src, dst, dirs_exist_ok=True)

# Delete d.ts files
for root, dirs, files in os.walk(dst):
    for f in files:
        if f.endswith('.d.ts'):
            os.remove(os.path.join(root, f))

# Rename the core files
os.rename(os.path.join(dst, 'charting_library.js'), os.path.join(dst, 'core.js'))
os.rename(os.path.join(dst, 'charting_library.standalone.js'), os.path.join(dst, 'core.standalone.js'))
os.rename(os.path.join(dst, 'charting_library.esm.js'), os.path.join(dst, 'core.esm.js'))
os.rename(os.path.join(dst, 'charting_library.cjs.js'), os.path.join(dst, 'core.cjs.js'))

print("Light obfuscation complete!")
