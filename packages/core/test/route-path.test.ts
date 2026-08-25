import { describe, expect, it } from 'vitest'
import corpus from '../spec/route-path.spec.json'
import {
  meanStopToLineMetres,
  nearestOnPath,
  orientToStops,
  type PathPoint,
  type RoutePathCandidate,
  resolveRoutePath,
  trimPathToStops,
} from '../src/route-path'
import type { LatLng } from '../src/types'
import { specCases } from './corpus'

// One `describe` per `@spec` group in ../spec/route-path.spec.json.
//
// The corpus's expected values were produced by a **separate implementation** (see the ADR), so
// these assertions are a cross-check between two independent readings of the rule rather than a
// recording of what this file happens to do. A row that disagrees means one of the two is wrong,
// which is the only useful kind of corpus.

const cases = <A, E>(group: string) => specCases<A, E>(corpus, group)

/** Corpus vertices are `[lng, lat]` (GeoJSON, as CSDI returns); our `LatLng` is the other way. */
const toLatLng = (p: readonly number[]): LatLng => ({ lng: p[0] as number, lat: p[1] as number })
const line = (pts: number[][]): PathPoint[] => pts.map((p) => [p[0], p[1]] as PathPoint)

describe('meanStopToLineMetres', () => {
  interface Args {
    stops: number[][]
    line: number[][]
  }
  interface Expected {
    /** `null` in the corpus = "no usable fit". The loader maps a *top-level* null to undefined, so
     *  a nested one arrives as `null` — compare loosely and accept either. */
    metres: number | null | undefined
    tolerance: number
  }
  for (const c of cases<Args, Expected>('meanStopToLineMetres')) {
    it(c.name, () => {
      const actual = meanStopToLineMetres(c.args.stops.map(toLatLng), line(c.args.line))
      if (c.expect.metres == null) {
        // JSON `null` is the language's absent value; here the rule returns "no usable fit".
        expect(Number.isFinite(actual)).toBe(false)
        return
      }
      expect(Math.abs(actual - c.expect.metres)).toBeLessThanOrEqual(c.expect.tolerance)
    })
  }
})

describe('nearestOnPath', () => {
  interface Args {
    line: number[][]
    point: number[]
  }
  interface Expected {
    index: number
    t: number
    distanceMetres: number
    tolerance: number
  }
  for (const c of cases<Args, Expected | undefined>('nearestOnPath')) {
    it(c.name, () => {
      const actual = nearestOnPath(line(c.args.line), toLatLng(c.args.point))
      if (!c.expect) {
        expect(actual).toBeNull()
        return
      }
      expect(actual).not.toBeNull()
      expect(actual?.index).toBe(c.expect.index)
      expect(Math.abs((actual?.t ?? 0) - c.expect.t)).toBeLessThanOrEqual(1e-4)
      expect(Math.abs((actual?.distanceMetres ?? 0) - c.expect.distanceMetres)).toBeLessThanOrEqual(
        c.expect.tolerance,
      )
    })
  }
})

describe('orientToStops', () => {
  interface Args {
    line: number[][]
    first: number[]
    last: number[]
  }
  for (const c of cases<Args, { reversed: boolean }>('orientToStops')) {
    it(c.name, () => {
      const source = line(c.args.line)
      const actual = orientToStops(source, toLatLng(c.args.first), toLatLng(c.args.last))
      expect(actual.reversed).toBe(c.expect.reversed)
      // Whatever it decides, the vertex set is preserved — orienting may not drop a point.
      expect(actual.line).toHaveLength(source.length)
      const head = actual.line[0] as PathPoint
      const expectedHead = (c.expect.reversed ? source[source.length - 1] : source[0]) as PathPoint
      expect(head[0]).toBeCloseTo(expectedHead[0], 9)
      expect(head[1]).toBeCloseTo(expectedHead[1], 9)
    })
  }
})

describe('trimPathToStops', () => {
  interface Args {
    line: number[][]
    first: number[]
    last: number[]
  }
  interface Expected {
    pathFirst: number[]
    pathLast: number[]
    pathLength: number
    trimmedStart: number
    trimmedEnd: number
    tolerance: number
  }
  for (const c of cases<Args, Expected>('trimPathToStops')) {
    it(c.name, () => {
      const actual = trimPathToStops(
        line(c.args.line),
        toLatLng(c.args.first),
        toLatLng(c.args.last),
      )
      expect(actual.path).toHaveLength(c.expect.pathLength)
      expect(actual.trimmedStart).toBe(c.expect.trimmedStart)
      expect(actual.trimmedEnd).toBe(c.expect.trimmedEnd)
      const first = actual.path[0] as PathPoint
      const last = actual.path[actual.path.length - 1] as PathPoint
      expect(Math.abs(first[0] - (c.expect.pathFirst[0] as number))).toBeLessThanOrEqual(
        c.expect.tolerance,
      )
      expect(Math.abs(first[1] - (c.expect.pathFirst[1] as number))).toBeLessThanOrEqual(
        c.expect.tolerance,
      )
      expect(Math.abs(last[0] - (c.expect.pathLast[0] as number))).toBeLessThanOrEqual(
        c.expect.tolerance,
      )
      expect(Math.abs(last[1] - (c.expect.pathLast[1] as number))).toBeLessThanOrEqual(
        c.expect.tolerance,
      )
    })
  }
})

describe('resolveRoutePath', () => {
  interface RawCandidate {
    id: string
    seq?: number
    matchedBy?: 'gtfsId' | 'routeNumber'
    line: number[][]
  }
  interface Args {
    stops: number[][]
    candidates: RawCandidate[]
  }
  interface Expected {
    id: string
    matchedBy: string
    fitMetres: number
    reversed: boolean
    trimmedStart: number
    trimmedEnd: number
    pathFirst: number[]
    pathLast: number[]
    pathLength: number
    tolerance: number
  }
  for (const c of cases<Args, Expected | undefined>('resolveRoutePath')) {
    it(c.name, () => {
      const candidates: RoutePathCandidate[] = c.args.candidates.map((raw) => ({
        id: raw.id,
        seq: raw.seq,
        matchedBy: raw.matchedBy,
        line: line(raw.line),
      }))
      const actual = resolveRoutePath(c.args.stops.map(toLatLng), candidates)
      if (!c.expect) {
        expect(actual).toBeNull()
        return
      }
      expect(actual).not.toBeNull()
      expect(actual?.id).toBe(c.expect.id)
      expect(actual?.matchedBy).toBe(c.expect.matchedBy)
      expect(actual?.reversed).toBe(c.expect.reversed)
      expect(actual?.trimmedStart).toBe(c.expect.trimmedStart)
      expect(actual?.trimmedEnd).toBe(c.expect.trimmedEnd)
      expect(actual?.path).toHaveLength(c.expect.pathLength)
      expect(Math.abs((actual?.fitMetres ?? 0) - c.expect.fitMetres)).toBeLessThanOrEqual(
        c.expect.tolerance,
      )
    })
  }
})
