# WA824 Visualizer

WA824 ISA로 작성된 프로그램을 **컴파일 → 어셈블 → CPU 실행 → 내부 상태 시각화**하는 로컬 웹 개발 도구입니다. CPU 구현을 플러그인으로 교체하면 **같은 ISA, 같은 프로그램**을 서로 다른 마이크로아키텍처에서 시험할 수 있습니다.

> 이 저장소의 주인공은 **CPU 설계 자체가 아닌 공용 실행·시각화 도구**입니다. 특정 학생의 SystemC CPU, 5단계 파이프라인 CPU, 미공개 draw.io 회로도는 포함하지 않습니다. 외부에서 작성한 CPU는 플러그인으로 추가합니다.

## 한눈에 보기

```text
       C 코드 ──> Python C 부분집합 컴파일러 ──┐
                                           v
   WA824 어셈블리 ───────────────────> JS 어셈블러
                                           |
                                    24비트 기계어
                                           |
                  +------------------------+---------------------+
                  |                                              |
          JS Reference CPU                             외부 CPU 플러그인
        (기본, 추가 설치 없음)                        (Verilog/SystemC 등)
                  +------------------------+---------------------+
                                           |
                                 실행 스냅샷 / 신호
                                           |
                              브라우저의 회로 시각화
```

- **기본 포함:** 6-phase JS 참조 CPU, Python 기반 C 부분집합 컴파일러, JS 2-pass 어셈블러, WA824 ABI·ECALL 시뮬레이터, 웹 UI.
- **선택 예제:** Icarus Verilog를 이용하는 교육용 멀티사이클 CPU 플러그인(`cpus/verilog/`).
- **확장 가능:** `cpus/<id>/`에 `architecture.json` + `adapter.js` + `implementation/`을 추가하면 자동으로 CPU 목록에 나타납니다.
- **파이프라인 지원:** 파이프라인 CPU 플러그인이 실제 클럭별 snapshot/activePhases를 제공하면 동시 단계 실행을 표시할 수 있습니다. **파이프라인 CPU 코드는 이 저장소에 포함하지 않습니다.**

## 시작하기 — Windows (권장)

**기본 JS CPU 실행에는 MSYS2, C++ 컴파일러, Icarus Verilog가 필요하지 않습니다.**

1. [Python 공식 사이트](https://www.python.org/downloads/windows/)에서 **Python 3.10 이상** 설치 (설치 시 `Add Python to PATH` 또는 `py` 런처 사용).
2. 이 저장소를 **Code → Download ZIP**으로 받아서 압축을 풉니다. Git 사용 시 `git clone <이 저장소의 URL>`로 받아도 됩니다.
3. 압축을 푼 폴더에서 `cmd` 또는 PowerShell을 엽니다.
4. 필수 Python 패키지를 설치합니다.

   ```powershell
   py -3 -m pip install -r requirements.txt
   ```

   `py` 명령이 없고 `python`은 된다면 `python -m pip install -r requirements.txt`로 대체하세요.

5. **`start.bat`** 실행 → 브라우저에서 **<http://localhost:8001>** 접속.
6. **CPU: `JS reference CPU`** → C 또는 Assembly 작성 → **Build & Load** → **Step / Run / Run to End**.

추가 예제인 **Verilog CPU**까지 쓰려면 MSYS2 UCRT64와 Icarus Verilog가 필요합니다. 정확한 설치 명령어·PATH 설정·문제 해결은 **[Windows 설치 완전 가이드](docs/INSTALL-WINDOWS.ko-KR.md)**를 참고하세요.

## macOS / Linux

Python 3.10+가 설치되어 있다면:

```sh
python3 -m pip install -r requirements.txt
./start.sh
```

`start.sh` 실행 권한이 없다면 `sh start.sh` 또는 `python3 backend/server.py`를 사용할 수 있습니다. 기본 포트는 8001입니다. Verilog CPU 실행 시 별도로 `iverilog`와 `vvp`가 필요합니다.

## 사용 예시

브라우저에서 다음 C 코드를 실행할 수 있습니다. `printf`, 함수, 반복문은 **지원되는 C 부분집합**에 한합니다.

```c
int main() {
    int x = 1;
    while (x <= 3) {
        print_int(x * x);
        putchar(10);
        x = x + 1;
    }
    return 0;
}
```

예상 stdout:

```text
1
4
9
```

다른 예제는 `examples/sum_input.c`(입력 `12 30` → `sum = 42`), `examples/fibonacci.c`, `examples/bubble_sort.c`, `examples/demo.asm` 등을 보세요. `Program stdin`에 입력한 내용은 **다음 Build & Load 때** 반영됩니다.

## 공용 CPU 플러그인 시스템

```text
cpus/
├── reference/               # 기본 JS 참조 CPU
│   ├── cpu.json
│   ├── adapter.js
│   ├── architecture.json
│   └── implementation/
├── verilog/                 # 선택 예제: Icarus Verilog
│   ├── cpu.json
│   ├── adapter.js
│   ├── architecture.json
│   └── implementation/
└── <your-cpu>/              # 사용자가 별도로 설치
    ├── cpu.json
    ├── adapter.js
    ├── architecture.json
    └── implementation/
```

플러그인의 이름과 메타데이터는 서버가 `/api/cpus`에서 검색합니다. 폴더를 추가한 후 **브라우저를 새로고침**하면 CPU 메뉴가 갱신됩니다. 같은 CPU라도 아키텍처 JSON을 바꾸면 표시되는 회로도도 변경됩니다. CPU의 실제 동작은 `implementation/`과 Adapter가 담당합니다.

- **[내 CPU 연결하기 (한국어)](docs/ADD-YOUR-CPU.ko-KR.md)**
- **[CPU 플러그인 / Snapshot 프로토콜](docs/CPU-PLUGINS.md)**
- **[Architecture JSON 구조](docs/ARCHITECTURE.md)**
- **[WA824 명령어 호환 규약](docs/WA824-ISA-COMPAT.md)**
- **[ABI 및 입출력](docs/ABI-IO.md)**

> ⚠️ 비주얼라이저는 임의의 SystemC/Verilog 소스를 자동 변환해 실행하지 않습니다. 실제 CPU 출력으로부터 정해진 Snapshot 형식으로 값을 추출하는 `runner.py` 또는 JS Adapter가 필요합니다. 신뢰할 수 없는 플러그인은 실행하지 마세요. 로컬 서버는 샌드박스가 아닙니다.

## 테스트

브라우저 실행에는 Node.js가 필요하지 않지만, **JS 테스트 실행에는 Node.js 20+**가 필요합니다.

```sh
node --test tests/*.test.js
python backend/python/test_compiler.py
python -m unittest discover -s backend -p 'test_cpu_plugins.py'
```

Verilog 관련 테스트는 **Icarus 설치 시**만 실제 RTL 검증이 진행됩니다. `SKIP`은 합격을 뜻하지 않습니다. 테스트 환경과 범위는 [테스트 안내](docs/TESTING.ko-KR.md)에 있습니다.

## 구성

```text
backend/    로컬 Python HTTP 서버, C 컴파일러, Verilog 실행 연결
src/        JS 어셈블러·CPU 포트·화면 렌더러
cpus/       CPU 플러그인
examples/   C/Assembly 예제
tools/      로컬 검증 보조 스크립트

templates/  새로운 CPU 플러그인 골격
tests/     자동 테스트
 docs/      ISA/ABI/설치/플러그인 규약 문서
```

`start.bat`, `start.sh`는 **로컬 개발 서버**를 시작합니다. GitHub Pages처럼 정적 파일만 제공하는 환경에서는 Python 컴파일러 API와 CPU 플러그인 검색이 동작하지 않습니다.

## 구현 범위와 한계

- 컴파일러는 ISO C 전체가 아닌 **교육용 C 부분집합**입니다. `struct`, 전체 libc, 일반적인 동적 메모리 관리, 완전한 C 전처리 등은 지원하지 않습니다.
- WA824는 24비트 고정 길이 명령어와 16비트 주소를 사용합니다. 명령어 인코딩의 정해지지 않은 영역은 이 프로젝트의 별도 관례를 적용합니다.
- `ECALL` 출력은 시뮬레이터의 호스트 서비스이며 실제 하드웨어 주변장치가 아닙니다.
- 예제 Verilog CPU는 멀티사이클 교육용 구현입니다. FPGA 검증, SystemC 합성, 학생 CPU의 정확성을 보증하지 않습니다.

자세한 출처·소유권 및 제공 범위는 [PROJECT-SCOPE](docs/PROJECT-SCOPE.ko-KR.md)를 참조하세요.

## 저작권 / 출처

이 저장소는 **WA824 ISA에 맞춰 구성한 공용 개발 도구**입니다. WA824 ISA와 외부 CPU 설계의 원 저작자 권리는 각 설계자에게 있으며, 이 저장소의 유지보수/구현 기여와 구분합니다. 학생의 CPU 코드·draw.io 원본은 포함하지 않았습니다. 재배포/라이선스 적용 전 코드와 ISA 문서 사용 허락을 확인하세요.

**라이선스:** [`LICENSE`](LICENSE) (MIT, 배포 전 권리 확인 권장). 기여 규칙: [CONTRIBUTING.md](CONTRIBUTING.md).
