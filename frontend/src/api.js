// Thin fetch wrapper. `/api` is proxied to the FastAPI service by Vite in dev
// and by nginx in the production image.
const BASE = import.meta.env.VITE_API_BASE || '/api'

async function handleResponse(res) {
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      if (body?.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail)
  }

  return res.status === 204 ? null : res.json()
}

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  return handleResponse(res)
}

export const api = {
  listTasks: () => request('/tasks'),
  createTask: (task) => request('/tasks', { method: 'POST', body: JSON.stringify(task) }),
  updateTask: (id, patch) => request(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteTask: (id) => request(`/tasks/${id}`, { method: 'DELETE' }),
  // One request for a whole drag, however many nodes moved.
  saveTaskPositions: (positions) =>
    request('/tasks/positions', { method: 'POST', body: JSON.stringify({ positions }) }),

  listEdges: () => request('/edges'),
  createEdge: (edge) => request('/edges', { method: 'POST', body: JSON.stringify(edge) }),
  deleteEdge: (id) => request(`/edges/${id}`, { method: 'DELETE' }),

  listProjects: () => request('/projects'),
  createProject: (project) => request('/projects', { method: 'POST', body: JSON.stringify(project) }),
  updateProject: (id, patch) => request(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  addToProject: (id, taskIds) =>
    request(`/projects/${id}/tasks`, { method: 'POST', body: JSON.stringify({ task_ids: taskIds }) }),
  deleteProject: (id) => request(`/projects/${id}`, { method: 'DELETE' }),

  listSources: (q) => request(`/sources${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  createSource: (source) => request('/sources', { method: 'POST', body: JSON.stringify(source) }),
  updateSource: (id, patch) => request(`/sources/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteSource: (id) => request(`/sources/${id}`, { method: 'DELETE' }),
  uploadSource: (formData) => fetch(`${BASE}/sources/upload`, { method: 'POST', body: formData }).then(handleResponse),

  listTaskSources: (taskId) => request(`/tasks/${taskId}/sources`),
  attachSources: (taskId, sourceIds) =>
    request(`/tasks/${taskId}/sources`, { method: 'POST', body: JSON.stringify({ source_ids: sourceIds }) }),
  detachSource: (taskId, sourceId) => request(`/tasks/${taskId}/sources/${sourceId}`, { method: 'DELETE' }),

  listProjectSources: (projectId) => request(`/projects/${projectId}/sources`),
  attachProjectSources: (projectId, sourceIds) =>
    request(`/projects/${projectId}/sources`, { method: 'POST', body: JSON.stringify({ source_ids: sourceIds }) }),
  detachProjectSource: (projectId, sourceId) =>
    request(`/projects/${projectId}/sources/${sourceId}`, { method: 'DELETE' }),
}
