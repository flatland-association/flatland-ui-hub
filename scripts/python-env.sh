# shellcheck shell=bash
# Which Python the backend can run on, for start-demo.sh and scripts/setup-dev.sh (sourced, not run).
# docs/plans/setup-python-torch-fixes.md.
#
# Supported: Python 3.10 – 3.12, built for the machine's own architecture.
# - 3.12 at most: requirements.txt pins numpy < 2, and numpy 1.26 has wheels only up to 3.12.
#   (numpy 2 support comes with flatland-rl 5.0.0.)
# - 3.10 at least: flatland-rl 4.3.0 requires it.
# - Native architecture: on Apple Silicon, an x86_64 Python (e.g. an Intel Anaconda, running under Rosetta) gets no
#   torch at all - torch has no Intel macOS wheels after 2.2.2.
#
#   pick_python            print the first supported interpreter: $PYTHON if set, else python3.12, 3.11, 3.10, python3
#   check_python PY        succeed if PY is supported, else set PYTHON_PROBLEM
#   check_venv DIR         succeed if the venv at DIR runs on a supported Python, else print how to rebuild it
#                          (the venv itself is never touched)

PYTHON_MIN_MINOR=10
PYTHON_MAX_MINOR=12
PYTHON_PROBLEM=""

_on_apple_silicon() {
  [ "$(uname -s)" = "Darwin" ] && [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = "1" ]
}

check_python() {
  local py="$1" info version machine minor
  if ! info="$("$py" -c 'import platform, sys; print("%d.%d %s" % (sys.version_info[0], sys.version_info[1], platform.machine()))' 2>/dev/null)"; then
    PYTHON_PROBLEM="$py does not run"
    return 1
  fi
  read -r version machine <<<"$info"
  minor="${version#*.}"
  if [ "${version%%.*}" != "3" ] || [ "$minor" -lt "$PYTHON_MIN_MINOR" ] || [ "$minor" -gt "$PYTHON_MAX_MINOR" ]; then
    PYTHON_PROBLEM="$py is Python $version; the backend needs 3.$PYTHON_MIN_MINOR – 3.$PYTHON_MAX_MINOR (numpy < 2 has no wheels for newer Pythons)"
    return 1
  fi
  if _on_apple_silicon && [ "$machine" != "arm64" ]; then
    PYTHON_PROBLEM="$py is an $machine build running under Rosetta on Apple Silicon (an Intel Anaconda, for example); torch has no Intel macOS wheels"
    return 1
  fi
  return 0
}

_install_hint() {
  if [ "$(uname -s)" = "Darwin" ]; then
    echo "  Install one, e.g.:  brew install python@3.12"
    echo "  and point the script at it:  PYTHON=$(_on_apple_silicon && echo /opt/homebrew || echo /usr/local)/bin/python3.12 $0"
  else
    echo "  Install Python 3.12 (e.g. from your package manager or python.org) and point the script at it:"
    echo "  PYTHON=/path/to/python3.12 $0"
  fi
}

pick_python() {
  local candidates candidate path problems=""
  if [ -n "${PYTHON:-}" ]; then
    candidates=("$PYTHON")
  else
    candidates=(python3.12 python3.11 python3.10 python3)
  fi
  for candidate in "${candidates[@]}"; do
    path="$(command -v "$candidate" 2>/dev/null)" || continue
    if check_python "$path"; then
      echo "$path"
      return 0
    fi
    problems+="  - $PYTHON_PROBLEM"$'\n'
  done
  {
    echo "! No supported Python for the backend (3.$PYTHON_MIN_MINOR – 3.$PYTHON_MAX_MINOR, native architecture)."
    if [ -n "$problems" ]; then
      printf '%s' "$problems"
    else
      echo "  - none of: ${candidates[*]} is on PATH"
    fi
    _install_hint
  } >&2
  return 1
}

check_venv() {
  local venv="$1" python
  check_python "$venv/bin/python" && return 0
  {
    echo "! $venv was built with an unsupported Python:"
    echo "  $PYTHON_PROBLEM"
    echo "  It is left as it is. To rebuild it on a supported Python:"
    if python="$(pick_python 2>/dev/null)"; then
      echo "    rm -rf $venv && $python -m venv $venv"
    else
      echo "    rm -rf $venv"
      _install_hint
    fi
    echo "  then run $0 again."
  } >&2
  return 1
}
