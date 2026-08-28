import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const moduleWorkRoot = await mkdtemp(join(tmpdir(), "oriai-shutdown-module-"));
process.env.ORI_AI_LOCAL_HOST = "127.0.0.1";
process.env.ORI_AI_LOCAL_PORT = "0";
process.env.ORI_AI_RESTORE_JOBS = "0";
process.env.ORI_AI_WORK_ROOT = moduleWorkRoot;

const {
  applyJobExecutionError,
  completeGracefulShutdown,
  JobRestartError,
  persistJobState,
  restorePersistedJobs,
  server,
} = await import("../local-oriedita/server.mjs?server-shutdown-test");

if (!server.listening) await once(server, "listening");

after(async () => {
  if (server.listening) {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
  await rm(moduleWorkRoot, { recursive: true, force: true });
});

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

test("restart waits for the aborted runner to close and persist queued work before replacement starts", async () => {
  const root = await mkdtemp(join(tmpdir(), "oriai-shutdown-job-"));
  try {
    const id = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const directory = join(root, id);
    await mkdir(directory, { recursive: true });
    const job = {
      id,
      type: "design",
      directory,
      designMode: "codex_mcp_loop",
      status: "running",
      message: "実行中",
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      completedAt: null,
      result: null,
      error: null,
      cancelRequested: false,
    };
    await persistJobState(job);

    const events = [];
    const runnerClose = deferred();
    const controller = new AbortController();
    let statePersisted = false;
    const activeExecution = new Promise((resolveExecution, rejectExecution) => {
      controller.signal.addEventListener("abort", () => {
        void (async () => {
          try {
            assert.ok(controller.signal.reason instanceof JobRestartError);
            events.push("restart-abort");
            await runnerClose.promise;
            events.push("runner-closed");
            const abortError = new Error("detached runner stopped");
            abortError.name = "AbortError";
            const requeue = applyJobExecutionError(job, abortError, { signal: controller.signal });
            assert.equal(requeue, true);
            job.completedAt = requeue ? null : new Date().toISOString();
            await persistJobState(job);
            statePersisted = true;
            events.push("execution-settled");
            resolveExecution();
          } catch (error) {
            rejectExecution(error);
          }
        })();
      }, { once: true });
    });
    const fakeServer = {
      listening: true,
      close(callback) {
        events.push("stop-accepting");
        this.listening = false;
        queueMicrotask(() => {
          events.push("server-closed");
          callback();
        });
      },
    };
    let replacementStarted = false;
    const shutdown = completeGracefulShutdown({
      serverInstance: fakeServer,
      abortControllers: new Map([[id, controller]]),
      activeExecution,
      exitCode: 0,
      exitImpl: (code) => {
        assert.equal(code, 0);
        assert.equal(statePersisted, true);
        replacementStarted = true;
        events.push("replacement-started");
      },
    });

    await new Promise((resolveImmediate) => setImmediate(resolveImmediate));
    assert.deepEqual(events, ["stop-accepting", "restart-abort", "server-closed"]);
    assert.equal(replacementStarted, false);
    assert.equal(job.status, "running");

    runnerClose.resolve();
    await shutdown;
    assert.deepEqual(events, [
      "stop-accepting",
      "restart-abort",
      "server-closed",
      "runner-closed",
      "execution-settled",
      "replacement-started",
    ]);
    assert.equal(job.status, "queued");
    assert.equal(job.cancelRequested, false);
    assert.equal(job.completedAt, null);
    assert.match(job.message, /再起動後/);

    const restoredJobs = new Map();
    const restoredQueue = [];
    await restorePersistedJobs({ root, jobsMap: restoredJobs, queueList: restoredQueue });
    assert.equal(restoredJobs.get(id).status, "queued");
    assert.equal(restoredJobs.get(id).cancelRequested, false);
    assert.deepEqual(restoredQueue, [id]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
