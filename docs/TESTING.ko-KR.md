# 테스트와 검증 수준

## 설치 검사

```sh
python --version
python -c "import pycparser; print(pycparser.__version__)"
node --version  # 선택: JS 테스트
iverilog -V    # 선택: Verilog CPU
vvp -V         # 선택: Verilog CPU
```

## 자동화 테스트

```sh
node --test tests/*.test.js
python backend/python/test_compiler.py
python -m unittest discover -s backend -p 'test_cpu_plugins.py'
```

Python 통합 검증 중 서버를 기동하는 테스트는 로컬 포트를 사용할 수 있습니다. Verilog 차등 테스트는 `iverilog`와 `vvp`가 설치되어야 실제로 실행됩니다. 없을 때 표시되는 `SKIP`은 **미검증**을 의미합니다.

## 수동 시연 체크리스트

1. `start.bat`/`start.sh` 실행, `/api/cpus`에 `reference`, `verilog`가 등록됨.
2. `JS reference CPU` 선택, C 기본 예제 → Build & Load → Run to End → 출력 `1`, `4`, `9` 확인.
3. Assembly 모드에서 `ADDI x1l, x0l, 3` + `EBRAKE` 실행.
4. `Reset`으로 초기 상태로 복구되는지, Step으로 회로 상태가 바뀌는지 확인.
5. (선택) Icarus 설치 후 Verilog CPU 선택 및 출력·레지스터 상태 대조.
6. (별도 CPU) Snapshot의 신호가 실제 실행에서 비롯되는지 별도 테스트.

## 보증하지 않는 내용

브라우저 UI의 모든 운영체제 조합, 학생 SystemC CPU, 실제 FPGA, 합성 툴 체인, 미작성 CPU 플러그인의 정확성은 자동 테스트 범위에 없습니다.
