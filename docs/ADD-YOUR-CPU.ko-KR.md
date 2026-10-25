# 새 CPU를 비주얼라이저에 연결하기

## 핵심 아이디어

공용 C 컴파일러와 어셈블러는 **WA824 ISA를 하나의 기계어 이미지로** 변환합니다. CPU 플러그인은 이 이미지를 받아 실제로 실행하고, 단계/클럭별 상태를 Snapshot으로 돌려줍니다. UI는 그 값으로 해당 CPU의 `architecture.json`을 그립니다.

```text
C/ASM source → WA824 bytes → your CPU → snapshot[] → architecture.json 기반 UI
```

CPU가 JS인지, Verilog인지, SystemC인지와 관계없이 ISA는 동일하게 유지합니다. SystemC/Verilog 코드를 올리기만 하면 자동으로 인터페이스가 만들어지는 것은 아닙니다.

## 최소 설치 구조

`templates/systemc-cpu/`의 골격을 복사해 새 디렉터리를 만듭니다.

```text
cpus/my-cpu/
├── cpu.json
├── adapter.js
├── architecture.json
└── implementation/
    ├── runner.py
    └── ... 사용자의 CPU 소스 ...
```

**폴더 이름은 영문자·숫자·하이픈·밑줄만** 사용하고, `cpu.json`의 `id`와 일치시킵니다.

```json
{
  "schemaVersion": 1,
  "id": "my-cpu",
  "name": "My WA824 CPU",
  "isa": "WA824"
}
```

## Adapter — 실행 계약

네이티브 CPU를 연결할 때는 `adapter.js`에서 내장 `TraceCpu`를 그대로 사용할 수 있습니다.

```js
import { TraceCpu } from '../../src/adapters/trace-cpu.js';
export function createCpu({ id }) { return new TraceCpu(id); }
```

Python 서버가 `implementation/runner.py`를 subprocess로 실행합니다.

**입력 (표준 입력 JSON)**

```json
{"bytes":[0,0,0],"origin":0,"input":""}
```

**출력 (표준 출력 JSON)**

```json
{
  "programSha256": "<입력 bytes를 SHA256 한 hex 문자열>",
  "snapshots": [
    {"pc":0,"registers":[0,0,0,0,0,0,0,0],"phase":"IF","halted":false,
     "activeNodes":["pc"],"activeEdges":[],"signals":{}}
  ]
}
```

위 출력은 **스키마 모양을 설명하는 예시**이지, 실행 가능한 프로그램이나 정상 종료 Trace는 아닙니다. 실제 runner는 시작 상태부터 종료(`halted:true`)까지 **실제 CPU의 단계/클럭별** 상태를 반환해야 합니다. `programSha256`이 다르면 서버가 거절합니다.

**중요:** `stdout`에는 JSON만 기록하고, C++ 빌드 메시지/진단 로그는 `stderr`에 기록하세요.

## Architecture — 시각화 계약

`architecture.json`의 node ID / edge ID와 Snapshot의 `activeNodes`, `activeEdges`, `nodeValues` 키를 일치시킵니다. 샘플은 `templates/systemc-cpu/architecture.json`과 `cpus/reference/architecture.json`을 참고하세요.

```json
{
  "schemaVersion": 1,
  "isa": "WA824",
  "name": "My pipeline",
  "viewBox": [0,0,1200,600],
  "phases": [{"id":"IF","label":"Fetch"},{"id":"ID","label":"Decode"}],
  "nodes": [{"id":"pc","x":20,"y":20,"width":120,"height":80,"label":"PC"}],
  "edges": []
}
```

파이프라인 CPU는 `activePhases` 및 각 단계별 명령어 식별 정보가 있으면 더 의미 있는 그림을 보여줄 수 있습니다. 시각화에서 중요한 값은 **실제 CPU 신호를 읽어 만든 값**이어야 합니다. 프런트엔드가 사실과 다른 활동 상태를 만들어서는 안 됩니다.

## 실행 / 디버깅

1. `cpu.json`, `architecture.json`, `adapter.js`, `implementation/runner.py`를 준비합니다.
2. `start.bat` 또는 `start.sh`로 서버 실행.
3. <http://localhost:8001/api/cpus>에 `my-cpu`가 있는지 확인.
4. 브라우저를 새로고침하고 CPU 드롭다운에서 `My WA824 CPU` 선택.
5. 간단한 `ADDI` / `EBRAKE` 프로그램부터 `Build & Load` → `Step`으로 확인.
6. Load/Store/Branch/Jump/ECALL/파이프라인 해저드 테스트로 점진적으로 확장.

보다 자세한 스키마와 제한: [`CPU-PLUGINS.md`](CPU-PLUGINS.md). CPU와 프런트엔드 연결은 **테스트벤치/런타임 어댑터의 책임**입니다. 원본 draw.io를 `architecture.json`으로 자동 변환하지 않습니다.

## 배포 권장 방식

공용 도구 저장소에서는 API와 참조 CPU를 제공하고, 학생 또는 다른 설계자의 CPU 코드는 **본인의 별도 저장소**에서 관리하세요. 독립 프로젝트를 사용하려면 이 저장소를 내려받은 뒤 `cpus/my-cpu/`만 복사하면 됩니다. 배포할 때 타인의 코드·ISA 문서에 대한 공개 동의를 먼저 받으세요.
