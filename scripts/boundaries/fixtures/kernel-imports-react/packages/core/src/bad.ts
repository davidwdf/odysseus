// The injected violation: the kernel reaching for a view framework.
//
// It imported `react-native` until that dependency left with `apps/mobile` (ADR-157) — and an import
// of a package nobody installs resolves to nothing, so the rule had nothing to catch and the selftest
// correctly reported the gate as vacuous. `react` is the same violation against a package this repo
// will always have, which is the property a fixture needs.
import { useState } from 'react'

export const bad = useState
