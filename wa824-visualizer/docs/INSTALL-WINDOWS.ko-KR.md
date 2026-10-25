# Windows 설치 및 실행 가이드

## 필요한 프로그램 — 무엇이 필수인가?

| 대상 | 필수 | 이유 |
|---|---|---|
| Python 3.10 이상 | **필수** | 로컬 서버, C 컴파일러 |
| Python 패키지 `pycparser` | **필수** | C 문법 파싱 (`requirements.txt`) |
| 최신 Chrome/Edge/Firefox | **필수** | 시각화 화면 |
| Node.js 20+ | 선택 | 로컬 JS 테스트/CLI 도구 |
| MSYS2 UCRT64 + Icarus Verilog | Verilog CPU에서만 | `iverilog`, `vvp` |
| MSYS2 UCRT64 + GCC | C++/SystemC CPU 플러그인에서만 | `g++`로 네이티브 빌드 |
| SystemC 라이브러리 | SystemC CPU 플러그인에서만 | 개별 플러그인의 SystemC 실험 환경; 기본 설치 아님 |

**기본 `JS reference CPU`에는 MSYS2, GCC, Verilog 또는 SystemC 설치가 필요 없습니다.**

## A. 우선 기본 JS CPU부터 실행

1. <https://www.python.org/downloads/windows/> 에서 Python 설치. `Add python.exe to PATH` 옵션 확인.
2. 저장소 ZIP 압축 해제. 경로에 공백이 있어도 `start.bat`이 자체적으로 폴더를 찾습니다.
3. 탐색기 주소창에 `cmd`를 입력해 해당 폴더에서 명령 프롬프트 시작.
4. 다음 명령어를 차례로 실행.

   ```bat
   py -3 --version
   py -3 -m pip install -r requirements.txt
   start.bat
   ```

   `py`가 없는 경우 `python --version`, `python -m pip install -r requirements.txt`를 사용하세요.

5. <http://localhost:8001> 접속 → CPU 선택: `JS reference CPU` → **Build & Load** → **Step** 또는 **Run to End**.

실행하는 동안 **검은 CMD 창을 닫지 마세요**. 닫으면 서버도 종료됩니다.

## B. 선택사항: MSYS2 UCRT64 / Icarus Verilog

Verilog 예제 CPU를 시뮬레이션하려면 다음 과정을 추가합니다.

1. MSYS2 공식 홈페이지 <https://www.msys2.org/>에서 설치 (보통 `C:\msys64`).
2. 시작 메뉴에서 **MSYS2 UCRT64** 터미널을 엽니다. `MSYS`, `MINGW64`와 혼동하지 마세요.
3. 패키지 목록 및 시스템을 업데이트합니다.

   ```sh
   pacman -Syu
   ```

   업데이트가 셸 종료를 요구하면 UCRT64 터미널을 다시 열고 `pacman -Syu`를 재실행합니다.
4. 다음 프로그램을 설치합니다.

   ```sh
   pacman -S mingw-w64-ucrt-x86_64-iverilog
   ```

   앞으로 C++/SystemC CPU 플러그인을 연결할 계획이면 별도로 `pacman -S mingw-w64-ucrt-x86_64-gcc`도 설치합니다. **참조 CPU/Verilog CPU 자체에는 GCC가 필요하지 않습니다.**

5. UCRT64 터미널에서 버전을 확인합니다.

   ```sh
   iverilog -V
   vvp -V
   g++ --version  # GCC를 설치한 경우에만
   ```

6. 일반 CMD에서 아래 명령어로 Windows에서 찾을 수 있는지 확인합니다.

   ```bat
   where iverilog
   where vvp
   ```

   인식되지 않으면 `start.bat`이 기본 설치 위치 `C:\msys64\ucrt64\bin`을 임시 PATH에 추가하므로 **start.bat로 서버를 시작해 사용**할 수 있습니다. 그래도 안 된다면 사용자 PATH에 `C:\msys64\ucrt64\bin`을 추가하고 터미널을 다시 실행하세요. 별도의 설치 경로를 썼다면 실제 설치 폴더로 변경하세요.

7. 기존 서버를 `Ctrl+C`로 종료하고 **start.bat 재실행** → CPU 선택: `Verilog CPU (Icarus)` → Build & Load.

MSYS2 패키지 공식 정보: [Icarus Verilog (UCRT64)](https://packages.msys2.org/packages/mingw-w64-ucrt-x86_64-iverilog), [GCC (UCRT64)](https://packages.msys2.org/packages/mingw-w64-ucrt-x86_64-gcc).

## C. 선택사항: Node.js (개발/테스트)

Node.js 20 이상을 설치하고 프로젝트 루트에서:

```bat
node --version
node --test tests\*.test.js
```

**주의:** Windows 셸에서는 와일드카드 처리 방식이 다를 수 있습니다. 문제가 나면 `npm test`를 시도하세요.

## 문제 해결

**`'py' is not recognized`**: `python` 명령을 시도하거나 Python Launcher 설치. `start.bat`은 `python`으로도 자동 대체를 시도합니다.

**`No module named pycparser`**: 실제 서버를 실행할 Python에 패키지를 설치하세요. `py -3 -m pip install -r requirements.txt`를 다시 실행합니다.

**`Loading CPUs...`이 계속 보임 / `/api/cpus`가 404**: HTML 파일을 직접 열었거나 다른 폴더의 예전 서버에 연결 중일 수 있습니다. 새 폴더에서 `start.bat`으로 실행하고 `http://localhost:8001/api/cpus`에 JSON 응답이 나오는지 확인하세요.

**포트 8001이 이미 사용 중**: 실행 중인 다른 서버 창에서 `Ctrl+C`. 확인은 `netstat -ano | findstr :8001`. 다른 포트 사용 시 `set WA824_PORT=8002` 후 같은 CMD에서 `start.bat`을 실행하고 `http://localhost:8002`에 접속합니다.

**`iverilog` / `vvp` not found**: MSYS2 UCRT64 설치 여부와 `C:\msys64\ucrt64\bin` 위치를 확인하세요. 프로그램 설치 후 실행 중 서버도 재시작해야 합니다.

**`g++ is required`**: 기본 JS/Verilog CPU에는 필요한 오류가 아닙니다. C++ CPU 플러그인을 선택했다면 UCRT64 GCC를 설치하고 서버 재시작.

**C 컴파일 오류**: 지원하지 않는 C 문법일 수 있습니다. [`ABI-IO.md`](ABI-IO.md)의 지원 문법 목록을 확인하세요. 처음에는 기본 예제 그대로 실행해 보세요.

**보안:** 서버는 기본적으로 `127.0.0.1`에 바인딩되는 로컬 개발용입니다. CPU 플러그인 코드는 서버 권한으로 실행할 수 있으니 신뢰하는 코드만 설치하세요.
