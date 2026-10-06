#!/usr/bin/env bash
# Build genuine pinned upstream programs into an external cache. No sudo.
set -euo pipefail
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
LOCK="$HERE/dependencies.lock.json"
ROOT=${1:-${BURONT_STATISTICAL_TOOLS:-"$HOME/.cache/buront-statistical-tools"}}
[[ "$ROOT" =~ ^/[A-Za-z0-9_./-]+$ ]] || { echo "Tool cache must be an absolute path containing only letters, digits, underscore, dot, slash, and hyphen" >&2; exit 2; }
JOBS=${JOBS:-2}
[[ "$JOBS" =~ ^[1-9][0-9]*$ ]] || { echo 'JOBS must be a positive integer' >&2; exit 2; }
[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || { echo 'This pinned bootstrap currently supports Linux x86_64 only' >&2; exit 2; }
for cmd in gcc g++ make perl git curl tar bzip2 python3 sha256sum; do command -v "$cmd" >/dev/null || { echo "Missing prerequisite: $cmd" >&2; exit 2; }; done
mkdir -p "$ROOT"
ROOT=$(cd "$ROOT" && pwd)
[[ "$ROOT" =~ ^/[A-Za-z0-9_./-]+$ ]] || { echo "Resolved cache path contains unsafe shell characters" >&2; exit 2; }
case "$ROOT/" in "$HERE/"*|"$(cd "$HERE/../.." && pwd)/"*) echo 'Choose a tool cache outside the repository' >&2; exit 2;; esac
mkdir -p "$ROOT"/{src,build,prefix/bin,downloads,logs}
trap 'status=$?; echo "Dependency build failed ($status); inspect $ROOT/logs" >&2; exit "$status"' ERR
PREFIX="$ROOT/prefix"
export OMP_NUM_THREADS="$JOBS"
export CPATH="$PREFIX/include${CPATH:+:$CPATH}"
export LIBRARY_PATH="$PREFIX/lib${LIBRARY_PATH:+:$LIBRARY_PATH}"
export BZIP2_INCLUDE="$PREFIX/include" BZIP2_LIBRARY_PATH="$PREFIX/lib"
read_lock() { python3 - "$LOCK" "$@" <<'PY'
import json,sys
v=json.load(open(sys.argv[1]))
for k in sys.argv[2:]: v=v[k]
print(v)
PY
}
fetch_archive() {
  local key=$1 name=$2 url sum
  url=$(read_lock build_dependencies "$key" url)
  sum=$(read_lock build_dependencies "$key" sha256)
  if [[ ! -f "$ROOT/downloads/$name" ]]; then
    curl --fail --location --retry 2 "$url" -o "$ROOT/downloads/$name.part"
    mv "$ROOT/downloads/$name.part" "$ROOT/downloads/$name"
  fi
  echo "$sum  $ROOT/downloads/$name" | sha256sum --check --status || { echo "Checksum mismatch: $name" >&2; exit 1; }
}
checkout_pinned() {
  local name=$1 url commit
  url=$(read_lock repositories "$name" url)
  commit=$(read_lock repositories "$name" commit)
  if [[ ! -d "$ROOT/src/$name/.git" ]]; then
    [[ ! -e "$ROOT/src/$name" ]] || { echo "Existing non-git source directory: $name" >&2; exit 1; }
    git init -q "$ROOT/src/$name"
    git -C "$ROOT/src/$name" remote add origin "$url"
    git -C "$ROOT/src/$name" fetch --depth 1 origin "$commit"
    git -C "$ROOT/src/$name" checkout -q --detach FETCH_HEAD
  fi
  [[ $(git -C "$ROOT/src/$name" remote get-url origin) == "$url" ]] || { echo "Unexpected upstream: $name" >&2; exit 1; }
  [[ $(git -C "$ROOT/src/$name" rev-parse HEAD) == "$commit" ]] || { echo "Wrong commit in $name; use a fresh cache" >&2; exit 1; }
}
for dep in fast_align kenlm mosesdecoder; do checkout_pinned "$dep"; done
# Only reviewed compatibility patches may modify pinned tracked sources.
shopt -s nullglob
for patch in "$HERE"/patches/*.patch; do
  if git -C "$ROOT/src/mosesdecoder" apply --reverse --check "$patch" 2>/dev/null; then :
  else git -C "$ROOT/src/mosesdecoder" apply --check "$patch"; git -C "$ROOT/src/mosesdecoder" apply "$patch"; fi
done
for dep in fast_align kenlm; do
  git -C "$ROOT/src/$dep" diff --quiet HEAD || { echo "Unexpected source edits: $dep" >&2; exit 1; }
done
# Compare the complete Moses diff with the documented patch, rejecting other edits.
patches=("$HERE"/patches/*.patch)
expected_patch=""
if [[ ${#patches[@]} -gt 0 ]]; then expected_patch=$(cat "${patches[@]}"); fi
actual_patch=$(git -C "$ROOT/src/mosesdecoder" diff --binary HEAD)
[[ "$actual_patch" == "$expected_patch" ]] || { echo 'Unexpected Moses source edits; use a fresh cache' >&2; exit 1; }
fetch_archive cmake cmake-3.31.6-linux-x86_64.tar.gz
fetch_archive boost boost_1_74_0.tar.bz2
fetch_archive bzip2 bzip2-1.0.8.tar.gz
if [[ ! -d "$ROOT/src/bzip2-1.0.8" ]]; then tar -xzf "$ROOT/downloads/bzip2-1.0.8.tar.gz" -C "$ROOT/src"; fi
make -C "$ROOT/src/bzip2-1.0.8" -j"$JOBS" libbz2.a > "$ROOT/logs/bzip2-build.log" 2>&1
mkdir -p "$PREFIX/include" "$PREFIX/lib"
cp "$ROOT/src/bzip2-1.0.8/bzlib.h" "$PREFIX/include/"
cp "$ROOT/src/bzip2-1.0.8/libbz2.a" "$PREFIX/lib/"
if [[ ! -x "$ROOT/cmake-3.31.6-linux-x86_64/bin/cmake" ]]; then
  tar -xzf "$ROOT/downloads/cmake-3.31.6-linux-x86_64.tar.gz" -C "$ROOT"
fi
CMAKE="$ROOT/cmake-3.31.6-linux-x86_64/bin/cmake"
if [[ ! -d "$ROOT/src/boost_1_74_0" ]]; then tar -xjf "$ROOT/downloads/boost_1_74_0.tar.bz2" -C "$ROOT/src"; fi
# Boost.Build is incremental; rerunning is safe and does not redownload packages.
(
  cd "$ROOT/src/boost_1_74_0"
  [[ -x ./b2 ]] || ./bootstrap.sh --prefix="$PREFIX" --with-libraries=system,thread,iostreams,program_options,serialization,filesystem,date_time,test,atomic,chrono
  ./b2 --reconfigure -j"$JOBS" --prefix="$PREFIX" --with-system --with-thread --with-iostreams --with-program_options --with-serialization --with-filesystem --with-date_time --with-test --with-atomic --with-chrono cxxflags=-std=c++14 link=static runtime-link=shared install
) > "$ROOT/logs/boost-build.log" 2>&1
"$CMAKE" -S "$ROOT/src/fast_align" -B "$ROOT/build/fast_align" -DCMAKE_BUILD_TYPE=Release > "$ROOT/logs/fast-align-build.log" 2>&1
"$CMAKE" --build "$ROOT/build/fast_align" -j"$JOBS" >> "$ROOT/logs/fast-align-build.log" 2>&1
"$CMAKE" -S "$ROOT/src/kenlm" -B "$ROOT/build/kenlm" -DCMAKE_BUILD_TYPE=Release -DCMAKE_PREFIX_PATH="$PREFIX" -DBOOST_ROOT="$PREFIX" -DBoost_NO_SYSTEM_PATHS=ON -DBoost_USE_STATIC_LIBS=ON -DENABLE_INTERPOLATE=OFF > "$ROOT/logs/kenlm-build.log" 2>&1
"$CMAKE" --build "$ROOT/build/kenlm" -j"$JOBS" --target lmplz build_binary query >> "$ROOT/logs/kenlm-build.log" 2>&1
(
  cd "$ROOT/src/mosesdecoder"
  ./bjam -j"$JOBS" --with-boost="$PREFIX" --without-tcmalloc --no-xmlrpc-c --without-libsegfault -q moses-cmd//moses phrase-extract//extract phrase-extract//score phrase-extract//consolidate
) > "$ROOT/logs/moses-build.log" 2>&1
for name in fast_align atools; do ln -sfn "$ROOT/build/fast_align/$name" "$PREFIX/bin/$name"; done
for name in lmplz build_binary query; do ln -sfn "$ROOT/build/kenlm/bin/$name" "$PREFIX/bin/$name"; done
mkdir -p "$ROOT/src/mosesdecoder/bin"
for name in moses extract score consolidate; do
  if [[ "$name" == moses ]]; then component=moses-cmd; else component=phrase-extract; fi
  mapfile -t candidates < <(find "$ROOT/src/mosesdecoder/$component/bin" -type f -name "$name" -executable)
  [[ ${#candidates[@]} == 1 ]] || { echo "Expected exactly one built $name, found ${#candidates[@]}" >&2; exit 1; }
  ln -sfn "${candidates[0]}" "$ROOT/src/mosesdecoder/bin/$name"
  ln -sfn "${candidates[0]}" "$PREFIX/bin/$name"
done
python3 - "$ROOT" "$LOCK" "$HERE" <<'PY'
import datetime,hashlib,json,os,pathlib,shutil,subprocess,sys
root,lock,here=map(pathlib.Path,sys.argv[1:])
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
names='fast_align atools moses extract score consolidate lmplz build_binary query'.split()
exe={n:str(root/'prefix/bin'/n) for n in names}
exe['train_model']=str(root/'src/mosesdecoder/scripts/training/train-model.perl')
for n,p in exe.items():
 if not os.access(p,os.X_OK): raise SystemExit(f'Executable unavailable: {n}: {p}')
manifest={'schema_version':1,'executables':exe,
 'commits':{k:v['commit'] for k,v in json.loads(lock.read_text())['repositories'].items()},
 'binary_sha256':{k:sha(pathlib.Path(v)) for k,v in exe.items()},
 'moses_bin_dir':str(root/'src/mosesdecoder/bin'),
 'moses_scripts_root':str(root/'src/mosesdecoder/scripts'),
 'helper_script_sha256':{str(p):sha(p) for folder in ('training','generic') for p in sorted((root/'src/mosesdecoder/scripts'/folder).rglob('*')) if p.is_file()},
 'system_tool_sha256':{str(pathlib.Path(shutil.which(n)).resolve()):sha(pathlib.Path(shutil.which(n)).resolve()) for n in ('perl','sort','gzip','split','cat','mkdir','rm','mv','head','tail','wc','cut','sed','awk','date','touch','basename','dirname','nice','gsort','gsplit','pigz') if shutil.which(n)},
 'dependency_lock_sha256':sha(lock),'build_script_sha256':sha(here/'build_dependencies.sh'),
 'patch_sha256':{p.name:sha(p) for p in sorted((here/'patches').glob('*.patch'))},
 'compiler':subprocess.check_output(['g++','--version'],text=True).splitlines()[0],
 'built_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'scope':'Compiled executables only; an integration smoke test is separate from build success.'}
(root/'toolchain.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(root/'toolchain.json')
PY
