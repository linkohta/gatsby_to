import ci from "ci-info"

const CI_DEFINITIONS = [
  getEnvDetect({ key: `NOW_BUILDER_ANNOTATE`, name: `ZEIT Now` }),
  getEnvDetect({ key: `NOW_REGION`, name: `ZEIT Now v1` }),
  getEnvDetect({ key: `VERCEL_URL`, name: `Vercel Now` }),
  getEnvDetect({ key: `VERCEL_BUILDER`, name: `Vercel Now` }),
  getEnvDetect({ key: `CODESANDBOX_SSE`, name: `CodeSandbox` }),
  getEnvDetect({ key: `CIRCLE_BRANCH`, name: `CircleCI` }),
  envFromCIAndCIName,
  getEnvFromCIInfo,
  envFromCIWithNoName,
]

function lookupCI(): string | null {
  for (const fn of CI_DEFINITIONS) {
    try {
      const res = fn()
      if (res) {
        return res
      }
    } catch (e) {
      // 無視する
    }
  }
  return null
}
const CIName = lookupCI()

/**
 * コードが実行されている環境が CI かどうかを判定する
 * @return 環境が CI であれば true、そうでなければ false
 */

export function isCI(): boolean {
  return !!CIName
}

/**
 * CI 環境の名前（"Vercel"、"Heroku" など）を取得する
 * @return 取得できた場合は CI の名前。CI でない場合のデフォルトは null
 */

export function getCIName(): string | null {
  if (!isCI()) {
    return null
  }
  return CIName
}

function getEnvFromCIInfo(): string | null {
  if (ci.isCI) return ci.name || `ci-info detected w/o name`
  return null
}

function getEnvDetect({
  key,
  name,
}: {
  key: string
  name: string
}): () => string | null {
  return function (): string | null {
    if (process.env[key]) {
      return name
    }
    return null
  }
}

function envFromCIAndCIName(): string | null {
  if (process.env.CI_NAME && process.env.CI) {
    return process.env.CI_NAME
  }
  return null
}

function envFromCIWithNoName(): `CI detected without name` | null {
  if (process.env.CI) {
    return `CI detected without name`
  }
  return null
}
