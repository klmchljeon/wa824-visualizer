# Contributing

WA824 Visualizer는 WA824 기계어의 실행과 CPU 상태 시각화를 위한 공용 개발 도구입니다.

- 버그 보고 시 OS / Python / 브라우저 버전, 재현 방법, CPU 플러그인 이름, 실행한 최소 C/Assembly 예제를 포함하세요.
- 기존 ISA 인코딩과 시뮬레이터 ABI를 임의로 바꾸지 말고, 변경안과 호환성 영향을 이슈로 설명하세요.
- 새로운 CPU는 `cpus/<id>/` 플러그인 형태로 구현하세요. 학생 또는 다른 저자의 소스/도면은 동의를 받아야 합니다.
- 가능한 한 `node --test tests/*.test.js`, `python backend/python/test_compiler.py`를 실행하세요.
- 모든 CPU 상태/신호 시각화는 실제 실행에 근거해야 합니다. 가짜 신호를 '실제 회로'로 표시하지 마세요.

적용 라이선스와 프로젝트 권한은 저장소 관리자가 최종 확인해야 합니다.
