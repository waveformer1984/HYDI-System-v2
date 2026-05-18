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
      'Cannot determine git source. Set VERCEL_DEPLOY_HOOK_HEIDI or VERCEL_DEPLOY_HOOK_HYDI for reliable redeployment.'
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

export const PROJECT_IDS = {
  heidi: process.env.VERCEL_PROJECT_HEIDI,
  hydi: process.env.VERCEL_PROJECT_HYDI,
}
