const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Resolve backend base URL.
 * - In dev, CRA can use a proxy, so relative "" is fine.
 * - In deployed envs, set REACT_APP_API_BASE_URL to your backend origin.
 */
function getApiBaseUrl() {
  return (process.env.REACT_APP_API_BASE_URL || "").replace(/\/+$/, "");
}

async function fetchJson(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  try {
    const res = await fetch(`${getApiBaseUrl()}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
    });

    const contentType = res.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");
    const body = isJson ? await res.json().catch(() => null) : await res.text().catch(() => "");

    if (!res.ok) {
      const message =
        (body && typeof body === "object" && (body.detail || body.message)) ||
        (typeof body === "string" && body) ||
        `Request failed (${res.status})`;
      const err = new Error(message);
      err.status = res.status;
      err.body = body;
      throw err;
    }

    return body;
  } finally {
    clearTimeout(timeout);
  }
}

// PUBLIC_INTERFACE
export async function listTasks() {
  /** Fetch all tasks. Returns Task[]. */
  return fetchJson("/tasks", { method: "GET" });
}

// PUBLIC_INTERFACE
export async function createTask(payload) {
  /** Create a task. Payload: {title, description}. Returns created Task. */
  return fetchJson("/tasks", { method: "POST", body: JSON.stringify(payload) });
}

// PUBLIC_INTERFACE
export async function updateTask(taskId, payload) {
  /** Update a task. Payload: {title, description, completed}. Returns updated Task. */
  return fetchJson(`/tasks/${encodeURIComponent(taskId)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

// PUBLIC_INTERFACE
export async function deleteTask(taskId) {
  /** Delete a task by id. Returns void/confirmation based on backend. */
  return fetchJson(`/tasks/${encodeURIComponent(taskId)}`, { method: "DELETE" });
}

