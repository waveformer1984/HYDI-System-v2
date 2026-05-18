// Vercel REST API admin wrapper
// Required env vars: VERCEL_ADMIN_TOKEN, VERCEL_TEAM_ID,
//   VERCEL_PROJECT_HEIDI, VERCEL_PROJECT_HYDI
// Optional: VERCEL_DEPLOY_HOOK_HEIDI, VERCEL_DEPLOY_HOOK_HYDI

const VERCEL_API = 'https://api.vercel.com'

function getAuth() {
  const token = process.env.VERCEL_ADMIN_TOKEN
  const teamId = process.env.VERCEL_TEAM_ID
  if (!token) throw new Error('VERCEL_ADMIN_TOKEN env var not set on this project')
  return { token, teamId }
}

async function vFetch(path, options = {}) {
  const { token, teamId } = getAuth()
  const hasQuery = path.includes('?')
  const teamQuery = teamId ? `${hasQuery ? '&' : '?'}teamId=${teamId}` : ''
  const url = `${VERCEL_API}${path}${teamQuery}`
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Vercel ${res.status} on ${path}: ${text}`)
  }
  return res.json()
}

export async function getLatestDeployment(projectId) {
  const data = await vFetch(`/v6/deployments?projectId=${projectId}&limit=1`)
  const d = data.deployments?.[0]
  if (!d) return null
  return {
    id: d.uid,
    state: d.state,
    url: d.url ? `https://${d.url}` : null,
    created: new Date(d.created).toISOString(),
    meta: d.meta || {},
  }
}

export async function triggerRedeploy(projectId) {
  // Prefer deploy hook if configured — most reliable, no git-source parsing needed
  const hookEnvKey = projectId === process.env.VERCEL_PROJECT_HEIDI
    ? 'VERCEL_DEPLOY_HOOK_HEIDI'
    : 'VERCEL_DEPLOY_HOOK_HYDI'
  const hookUrl = process.env[hookEnvKey]
  if (hookUrl) {
    const res = await fetch(hookUrl, { method: 'POST' })
    if (!res.ok) throw new Error(`Deploy hook failed: ${res.status}`)
    const data = await res.json()
    return { id: data.job?.id ?? null, url: null, state: 'BUILDING', via: 'hook' }
  }

  // Fall back: create deployment from last known git source
  const latest = await getLatestDeployment(projectId)
  if (!latest) throw new Error('No prior deployment found to redeploy from')
  const { meta } = latest

  if (!meta.githubRepoId || !meta.githubCommitRef) {
    throw new Error(
      'Cannot determine git source. Run `setup hooks` to create deploy hooks for reliable redeployment.'
    )
  }

  const repoName = [meta.githubOrg, meta.githubRepo].filter(Boolean).join('-') || projectId
  const body = {
    name: repoName,
    project: projectId,
    gitSource: {
      type: 'github',
      repoId: meta.githubRepoId,
      ref: meta.githubCommitRef,
    },
  }

  const result = await vFetch('/v13/deployments', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return {
    id: result.id,
    url: result.url ? `https://${result.url}` : null,
    state: result.readyState,
    via: 'api',
  }
}

export async function listEnvVars(projectId) {
  const data = await vFetch(`/v9/projects/${projectId}/env`)
  return (data.envs || []).map(e => ({
    id: e.id,
    key: e.key,
    target: Array.isArray(e.target) ? e.target : [e.target],
    type: e.type,
  }))
}

export async function setEnvVar(projectId, key, value, target = ['production', 'preview']) {
  const existing = await listEnvVars(projectId)
  const found = existing.find(e => e.key === key)

  if (found) {
    await vFetch(`/v9/projects/${projectId}/env/${found.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ value, target }),
    })
    return { action: 'updated', key }
  }

  await vFetch(`/v10/projects/${projectId}/env`, {
    method: 'POST',
    body: JSON.stringify([{ key, value, target, type: 'encrypted' }]),
  })
  return { action: 'created', key }
}

// Creates a deploy hook on the given project. Returns { id, url, name, ref }.
export async function createDeployHook(projectId, name, ref = 'main') {
  const data = await vFetch(`/v1/projects/${projectId}/deploy-hooks`, {
    method: 'POST',
    body: JSON.stringify({ name, ref }),
  })
  return { id: data.hook.id, url: data.hook.url, name: data.hook.name, ref: data.hook.ref }
}

// Creates deploy hooks for both heidi and hydi, then stores the hook URLs as
// encrypted env vars on the HYDI project so future redeployments use the hook
// path rather than the git-source fallback.
export async function setupDeployHooks() {
  if (!PROJECT_IDS.hydi) throw new Error('VERCEL_PROJECT_HYDI not set — cannot store hook env vars')
  const configs = [
    { id: PROJECT_IDS.heidi, envKey: 'VERCEL_DEPLOY_HOOK_HEIDI', hookName: 'heidi-auto-redeploy' },
    { id: PROJECT_IDS.hydi,  envKey: 'VERCEL_DEPLOY_HOOK_HYDI',  hookName: 'hydi-auto-redeploy'  },
  ]
  const results = []
  for (const { id, envKey, hookName } of configs) {
    if (!id) {
      results.push({ envKey, error: 'project ID not configured' })
      continue
    }
    const hook = await createDeployHook(id, hookName)
    await setEnvVar(PROJECT_IDS.hydi, envKey, hook.url)
    results.push({ envKey, hookId: hook.id })
  }
  return results
}

export const PROJECT_IDS = {
  heidi: process.env.VERCEL_PROJECT_HEIDI,
  hydi:  process.env.VERCEL_PROJECT_HYDI,
}
