import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { createTask, deleteTask, listTasks, updateTask } from "./api/tasksApi";

/**
 * Normalize task objects from backend.
 * Backend schema may differ; we defensively support common fields.
 */
function normalizeTask(raw) {
  const id = raw?.id ?? raw?.task_id ?? raw?._id ?? raw?.uuid ?? raw?.pk;
  return {
    id,
    title: raw?.title ?? "",
    description: raw?.description ?? "",
    completed: Boolean(raw?.completed ?? raw?.is_completed ?? raw?.done ?? false),
  };
}

/**
 * Best-effort extract a stable "id" (string/number) from a task.
 */
function getTaskId(task) {
  return task?.id;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// PUBLIC_INTERFACE
function App() {
  /** Main single-page to-do app. */
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingNew, setSavingNew] = useState(false);
  const [error, setError] = useState("");

  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const [search, setSearch] = useState("");
  const [showCompleted, setShowCompleted] = useState(true);

  // Inline edit state
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [rowBusyIds, setRowBusyIds] = useState(() => new Set());

  const newTitleRef = useRef(null);

  const stats = useMemo(() => {
    const total = tasks.length;
    const done = tasks.filter((t) => t.completed).length;
    return { total, done, open: total - done };
  }, [tasks]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((t) => {
      if (!showCompleted && t.completed) return false;
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        (t.description || "").toLowerCase().includes(q)
      );
    });
  }, [tasks, search, showCompleted]);

  async function refresh() {
    setError("");
    setLoading(true);
    try {
      const data = await listTasks();
      const arr = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
      setTasks(arr.map(normalizeTask).filter((t) => getTaskId(t) !== undefined && getTaskId(t) !== null));
    } catch (e) {
      setError(e?.message || "Failed to load tasks.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function onCreate(e) {
    e.preventDefault();
    setError("");

    if (!isNonEmptyString(newTitle)) {
      setError("Title is required.");
      newTitleRef.current?.focus?.();
      return;
    }

    setSavingNew(true);
    try {
      const created = await createTask({
        title: newTitle.trim(),
        description: (newDescription || "").trim(),
      });

      // Optimistic append if backend returns task; otherwise refresh.
      if (created && typeof created === "object") {
        const nt = normalizeTask(created);
        if (getTaskId(nt) !== undefined && getTaskId(nt) !== null) {
          setTasks((prev) => [nt, ...prev]);
        } else {
          await refresh();
        }
      } else {
        await refresh();
      }

      setNewTitle("");
      setNewDescription("");
      newTitleRef.current?.focus?.();
    } catch (e2) {
      setError(e2?.message || "Failed to create task.");
    } finally {
      setSavingNew(false);
    }
  }

  function beginEdit(task) {
    const id = getTaskId(task);
    setEditingId(id);
    setEditTitle(task.title || "");
    setEditDescription(task.description || "");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditTitle("");
    setEditDescription("");
  }

  function setRowBusy(id, busy) {
    setRowBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function onToggleCompleted(task) {
    const id = getTaskId(task);
    if (id === undefined || id === null) return;
    setError("");

    const nextCompleted = !task.completed;
    // optimistic UI
    setTasks((prev) => prev.map((t) => (getTaskId(t) === id ? { ...t, completed: nextCompleted } : t)));

    setRowBusy(id, true);
    try {
      await updateTask(id, {
        title: task.title,
        description: task.description,
        completed: nextCompleted,
      });
    } catch (e) {
      // rollback
      setTasks((prev) => prev.map((t) => (getTaskId(t) === id ? { ...t, completed: task.completed } : t)));
      setError(e?.message || "Failed to update task.");
    } finally {
      setRowBusy(id, false);
    }
  }

  async function onSaveEdit(task) {
    const id = getTaskId(task);
    if (id === undefined || id === null) return;
    setError("");

    if (!isNonEmptyString(editTitle)) {
      setError("Title is required.");
      return;
    }

    const payload = {
      title: editTitle.trim(),
      description: (editDescription || "").trim(),
      completed: Boolean(task.completed),
    };

    // optimistic update
    setTasks((prev) =>
      prev.map((t) => (getTaskId(t) === id ? { ...t, ...payload } : t))
    );

    setRowBusy(id, true);
    try {
      const updated = await updateTask(id, payload);
      if (updated && typeof updated === "object") {
        const nt = normalizeTask(updated);
        if (getTaskId(nt) !== undefined && getTaskId(nt) !== null) {
          setTasks((prev) => prev.map((t) => (getTaskId(t) === id ? nt : t)));
        }
      }
      cancelEdit();
    } catch (e) {
      setError(e?.message || "Failed to save changes.");
      // fallback to refresh to ensure consistency
      await refresh();
      cancelEdit();
    } finally {
      setRowBusy(id, false);
    }
  }

  async function onDelete(task) {
    const id = getTaskId(task);
    if (id === undefined || id === null) return;

    setError("");
    const title = task.title || "this task";
    const ok = window.confirm(`Delete "${title}"?`);
    if (!ok) return;

    // optimistic removal
    const prevTasks = tasks;
    setTasks((prev) => prev.filter((t) => getTaskId(t) !== id));

    setRowBusy(id, true);
    try {
      await deleteTask(id);
      if (editingId === id) cancelEdit();
    } catch (e) {
      setTasks(prevTasks);
      setError(e?.message || "Failed to delete task.");
    } finally {
      setRowBusy(id, false);
    }
  }

  const apiHint = process.env.REACT_APP_API_BASE_URL
    ? `API: ${process.env.REACT_APP_API_BASE_URL}`
    : "API: (same-origin / proxy)";

  return (
    <div className="App">
      <div className="page">
        <header className="header">
          <div className="brand">
            <h1 className="title">To‑Do</h1>
            <p className="subtitle">
              Add tasks, edit in place, and keep track of what’s done.
            </p>
          </div>
          <div className="pill" title={apiHint}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: "#06b6d4",
                  boxShadow: "0 0 0 4px rgba(6, 182, 212, 0.16)",
                }}
              />
              {stats.open} open / {stats.done} done
            </span>
          </div>
        </header>

        <div className="grid">
          {/* Create form */}
          <section className="card" aria-label="Create a new task">
            <div className="cardHeader">
              <h2 className="cardTitle">New task</h2>
              {savingNew ? (
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#64748b", fontSize: 13 }}>
                  <span className="spinner" aria-hidden="true" /> Saving…
                </div>
              ) : (
                <div className="hint">
                  Tip: press <kbd>Enter</kbd> on title to add
                </div>
              )}
            </div>

            <div className="cardBody">
              {error ? (
                <div className="banner" role="alert" aria-live="polite" style={{ marginBottom: 12 }}>
                  {error}
                </div>
              ) : null}

              <form className="form" onSubmit={onCreate}>
                <div className="field">
                  <div className="labelRow">
                    <label className="label" htmlFor="newTitle">
                      Title
                    </label>
                    <span className="hint">Required</span>
                  </div>
                  <input
                    ref={newTitleRef}
                    id="newTitle"
                    className="input"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="e.g., Buy groceries"
                    disabled={savingNew}
                    onKeyDown={(e) => {
                      // Allow quick-add with Enter in title (without requiring focus shift)
                      if (e.key === "Enter" && !e.shiftKey) {
                        // let form submit
                      }
                    }}
                  />
                </div>

                <div className="field">
                  <div className="labelRow">
                    <label className="label" htmlFor="newDesc">
                      Description
                    </label>
                    <span className="hint">Optional</span>
                  </div>
                  <textarea
                    id="newDesc"
                    className="textarea"
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    placeholder="Add details (optional)…"
                    disabled={savingNew}
                  />
                </div>

                <div className="actionsRow">
                  <button
                    type="button"
                    className="btn btnGhost"
                    onClick={() => {
                      setNewTitle("");
                      setNewDescription("");
                      setError("");
                      newTitleRef.current?.focus?.();
                    }}
                    disabled={savingNew}
                  >
                    Clear
                  </button>
                  <button className="btn btnPrimary" type="submit" disabled={savingNew}>
                    Add task
                  </button>
                </div>
              </form>
            </div>
          </section>

          {/* Task list */}
          <main className="card" aria-label="Task list">
            <div className="cardHeader">
              <h2 className="cardTitle">Tasks</h2>
              <div className="toolbar">
                <div className="search">
                  <div className="searchIcon" aria-hidden="true">
                    ⌕
                  </div>
                  <input
                    className="input"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search title/description…"
                    aria-label="Search tasks"
                  />
                </div>

                <button
                  type="button"
                  className="btn btnGhost"
                  onClick={() => setShowCompleted((v) => !v)}
                  aria-pressed={!showCompleted}
                  title="Toggle completed visibility"
                >
                  {showCompleted ? "Hide completed" : "Show completed"}
                </button>
              </div>
            </div>

            {loading ? (
              <div className="cardBody" style={{ display: "flex", alignItems: "center", gap: 10, color: "#64748b" }}>
                <span className="spinner" aria-hidden="true" />
                Loading tasks…
              </div>
            ) : (
              <>
                {filtered.length === 0 ? (
                  <div className="empty">
                    {tasks.length === 0 ? (
                      <>
                        No tasks yet. Add one on the left.
                        <div style={{ marginTop: 8, fontSize: 13 }}>
                          Suggested: “Plan weekend trip”
                        </div>
                      </>
                    ) : (
                      <>
                        No matching tasks.
                        <div style={{ marginTop: 8, fontSize: 13 }}>
                          Try clearing the search or showing completed.
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <ul className="list">
                    {filtered.map((task) => {
                      const id = getTaskId(task);
                      const busy = rowBusyIds.has(id);
                      const isEditing = editingId === id;

                      return (
                        <li key={String(id)} className="task">
                          <input
                            type="checkbox"
                            className="checkbox"
                            checked={task.completed}
                            onChange={() => onToggleCompleted(task)}
                            disabled={busy}
                            aria-label={task.completed ? "Mark as not completed" : "Mark as completed"}
                          />

                          <div className="taskMain">
                            <div className="taskTitleRow">
                              <p
                                className={[
                                  "taskTitle",
                                  task.completed ? "taskTitleCompleted" : "",
                                ].join(" ")}
                              >
                                {task.title}
                              </p>
                              {task.completed ? <span className="badge">Completed</span> : null}
                              {busy ? <span className="spinner" aria-label="Working" /> : null}
                            </div>

                            {task.description ? (
                              <p className="taskDesc">{task.description}</p>
                            ) : null}

                            {isEditing ? (
                              <div className="editGrid" aria-label="Edit task">
                                <input
                                  className="input"
                                  value={editTitle}
                                  onChange={(e) => setEditTitle(e.target.value)}
                                  placeholder="Title"
                                  disabled={busy}
                                />
                                <textarea
                                  className="textarea"
                                  value={editDescription}
                                  onChange={(e) => setEditDescription(e.target.value)}
                                  placeholder="Description"
                                  disabled={busy}
                                />
                                <div className="smallRow">
                                  <button
                                    type="button"
                                    className="btn btnGhost"
                                    onClick={cancelEdit}
                                    disabled={busy}
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btnPrimary"
                                    onClick={() => onSaveEdit(task)}
                                    disabled={busy}
                                  >
                                    Save
                                  </button>
                                </div>
                              </div>
                            ) : null}
                          </div>

                          <div className="taskActions">
                            <button
                              type="button"
                              className="iconBtn"
                              onClick={() => beginEdit(task)}
                              disabled={busy}
                              aria-label="Edit task"
                              title="Edit"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="iconBtn iconBtnDanger"
                              onClick={() => onDelete(task)}
                              disabled={busy}
                              aria-label="Delete task"
                              title="Delete"
                            >
                              Delete
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}

                <div className="statusLine" aria-label="Footer status">
                  <span>
                    {stats.total} total • {stats.open} open • {stats.done} done
                  </span>
                  <button type="button" className="btn btnGhost" onClick={refresh} disabled={loading}>
                    Refresh
                  </button>
                </div>
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

export default App;

