import * as Scheduler from "../scheduling/Scheduler.ts";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import { type ScheduledTask, ScheduledTaskUpsertInput, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";

import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ScheduledTaskService from "./ScheduledTaskService.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";

const decodeUpsertInput = Schema.decodeUnknownEffect(ScheduledTaskUpsertInput);

it.effect("rejects a stale form save after deletion while preserving explicit-id creates", () =>
  Effect.gen(function* () {
    const layerDependencies = Layer.mergeAll(
      NodeCrypto.layer,
      Scheduler.layer,
      ManagedPolicy.layerTest(),
      Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
      Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
        namedProjectsRoot: "/projects",
        isScratchProject: () => Effect.succeed(false),
      }),
      Layer.mock(ThreadManagementService.ThreadManagementService)({}),
      Layer.mock(SecretRequests.SecretRequests)({}),
    );
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const input = yield* decodeUpsertInput({
        id: "scheduled-task:edit-after-delete",
        title: "Review",
        prompt: "Review the open pull requests.",
        enabled: true,
        schedule: { type: "interval", everyMs: 60_000 },
        projectId: "project-stale-schedule",
        workspaceStrategy: { type: "root" },
        modelSelection: { instanceId: "codex", model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
      });
      const created = yield* service.upsert(input);
      const edit = yield* decodeUpsertInput({ ...input, requireExisting: true, title: "Edited" });
      expect((yield* service.upsert(edit)).task.title).toBe("Edited");
      yield* service.delete({ id: created.task.id });

      const failure = yield* service.upsert(edit).pipe(Effect.flip);
      expect(failure.message).toBe("Schedule task not found.");
      expect((yield* service.list()).tasks).toEqual([]);

      expect((yield* service.upsert(input)).task.id).toBe(created.task.id);
    }).pipe(Effect.provide(ScheduledTaskService.layer.pipe(Layer.provide(layerDependencies))));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("preserves a due run when a save only pads the scheduled hour", () =>
  Effect.gen(function* () {
    const dueAt = DateTime.makeZonedUnsafe(
      { year: 2026, month: 7, day: 1, hour: 9, minute: 0, second: 0, millisecond: 0 },
      { timeZone: DateTime.zoneMakeLocal(), adjustForTimeZone: true },
    );
    yield* TestClock.setTime(DateTime.toEpochMillis(dueAt) - 1_000);

    const layerDependencies = Layer.mergeAll(
      NodeCrypto.layer,
      Scheduler.layer,
      ManagedPolicy.layerTest(),
      Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
      Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
        namedProjectsRoot: "/projects",
        isScratchProject: () => Effect.succeed(false),
      }),
      Layer.mock(ThreadManagementService.ThreadManagementService)({}),
      Layer.mock(SecretRequests.SecretRequests)({}),
    );
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const input = yield* decodeUpsertInput({
        commandId: "schedule-time-format",
        title: "Morning review",
        prompt: "Review the open pull requests.",
        enabled: true,
        schedule: { type: "fixed_time", timeOfDay: "9:00" },
        projectId: "project-schedule-time-format",
        workspaceStrategy: { type: "root" },
        modelSelection: { instanceId: "codex", model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        creationSource: "mcp",
      });
      const created = yield* service.upsert(input);
      const expectedDueAt = DateTime.formatIso(DateTime.toUtc(dueAt));
      expect(created.task.nextRunAt).toBe(expectedDueAt);

      yield* TestClock.setTime(DateTime.toEpochMillis(dueAt) + 1_000);
      const update = yield* decodeUpsertInput({
        ...input,
        id: created.task.id,
        schedule: { type: "fixed_time", timeOfDay: "09:00" },
      });
      const updated = yield* service.upsert(update);
      expect(updated.task.nextRunAt).toBe(expectedDueAt);
      expect((yield* service.list()).tasks[0]?.nextRunAt).toBe(expectedDueAt);

      const rescheduled = yield* service.upsert({
        ...update,
        schedule: { type: "fixed_time", timeOfDay: "09:30" },
      });
      expect(rescheduled.task.nextRunAt).toBe(
        DateTime.formatIso(DateTime.toUtc(DateTime.add(dueAt, { minutes: 30 }))),
      );
    }).pipe(Effect.provide(ScheduledTaskService.layer.pipe(Layer.provide(layerDependencies))));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("keeps the task list order when a toggle or edit rewrites updated_at", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-07-01T09:00:00.000Z"));
    const layerDependencies = Layer.mergeAll(
      NodeCrypto.layer,
      Scheduler.layer,
      ManagedPolicy.layerTest(),
      Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
      Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
        namedProjectsRoot: "/projects",
        isScratchProject: () => Effect.succeed(false),
      }),
      Layer.mock(ThreadManagementService.ThreadManagementService)({}),
      Layer.mock(SecretRequests.SecretRequests)({}),
    );
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const input = (id: string) => ({
        id,
        title: id,
        prompt: "Review the open pull requests.",
        enabled: true,
        schedule: { type: "interval", everyMs: 60_000 },
        projectId: "project-stable-order",
        workspaceStrategy: { type: "root" },
        modelSelection: { instanceId: "codex", model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
      });
      const listedIds = service
        .list()
        .pipe(Effect.map(({ tasks }) => tasks.map((task) => String(task.id))));

      const older = yield* service.upsert(yield* decodeUpsertInput(input("scheduled-task:older")));
      yield* TestClock.adjust("1 second");
      yield* service.upsert(yield* decodeUpsertInput(input("scheduled-task:newer")));
      const order = ["scheduled-task:newer", "scheduled-task:older"];
      expect(yield* listedIds).toEqual(order);

      yield* TestClock.adjust("1 second");
      const toggled = yield* service.setEnabled({ id: older.task.id, enabled: false });
      expect(toggled.task.updatedAt > older.task.updatedAt).toBe(true);
      expect(yield* listedIds).toEqual(order);

      yield* TestClock.adjust("1 second");
      const edit = { ...input(older.task.id), requireExisting: true, title: "Edited" };
      yield* service.upsert(yield* decodeUpsertInput({ ...edit, enabled: false }));
      expect(yield* listedIds).toEqual(order);
    }).pipe(Effect.provide(ScheduledTaskService.layer.pipe(Layer.provide(layerDependencies))));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect(
  "idle polls still wake for tasks saved later, recorded due times, and beside far-future tasks",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-07-01T09:00:00.000Z"));
      const launched = yield* Deferred.make<string>();
      const layerDependencies = Layer.mergeAll(
        NodeCrypto.layer,
        Scheduler.layer,
        ManagedPolicy.layerTest(),
        Layer.mock(ThreadLaunchService.ThreadLaunchService)({
          launch: (input) =>
            Deferred.succeed(launched, input.title).pipe(
              Effect.as({ threadId: "thread-idle-poll", resumed: false } as never),
            ),
        }),
        Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
          namedProjectsRoot: "/projects",
          isScratchProject: () => Effect.succeed(false),
        }),
        Layer.mock(ThreadManagementService.ThreadManagementService)({}),
        Layer.mock(SecretRequests.SecretRequests)({}),
      );
      yield* Effect.gen(function* () {
        const service = yield* ScheduledTaskService.ScheduledTaskService;
        // The first poll finds no tasks and remembers that nothing is due.
        yield* TestClock.adjust("6 seconds");
        // Its year-10000+ next run sorts first as text; it must not hide the task below.
        yield* service.upsert(
          yield* decodeUpsertInput({
            title: "Far future",
            prompt: "Review the open pull requests.",
            enabled: true,
            schedule: { type: "interval", everyMs: 3e14 },
            projectId: "project-idle-poll",
            workspaceStrategy: { type: "root" },
            modelSelection: { instanceId: "codex", model: "gpt-5.4" },
            runtimeMode: "full-access",
            interactionMode: "default",
          }),
        );
        const created = yield* service.upsert(
          yield* decodeUpsertInput({
            title: "Idle poll",
            prompt: "Review the open pull requests.",
            enabled: true,
            schedule: { type: "interval", everyMs: 60_000 },
            projectId: "project-idle-poll",
            workspaceStrategy: { type: "root" },
            modelSelection: { instanceId: "codex", model: "gpt-5.4" },
            runtimeMode: "full-access",
            interactionMode: "default",
          }),
        );
        // This poll records the new task's due time; the later ones must still fire it.
        yield* TestClock.adjust("6 seconds");
        yield* TestClock.adjust("60 seconds");
        expect(yield* Deferred.await(launched)).toBe(created.task.title);
      }).pipe(Effect.provide(ScheduledTaskService.layer.pipe(Layer.provide(layerDependencies))));
    }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

const catchUpInput = (catchUpToday: boolean) =>
  decodeUpsertInput({
    commandId: `catch-up-${catchUpToday}`,
    title: "Nights check-in",
    prompt: "Run the morning check-in.",
    enabled: true,
    schedule: { type: "fixed_time", timeOfDay: "09:00", catchUpToday },
    projectId: "project-catch-up",
    workspaceStrategy: { type: "root" },
    modelSelection: { instanceId: "codex", model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
  });

const localTime = (day: number, hour: number, minute = 0) =>
  DateTime.makeZonedUnsafe(
    { year: 2026, month: 7, day, hour, minute, second: 0, millisecond: 0 },
    { timeZone: DateTime.zoneMakeLocal(), adjustForTimeZone: true },
  );
const isoAt = (day: number, hour: number) =>
  DateTime.formatIso(DateTime.toUtc(localTime(day, hour)));

const catchUpDependencies = (onLaunch: Effect.Effect<void>) =>
  Layer.mergeAll(
    NodeCrypto.layer,
    Scheduler.layer,
    ManagedPolicy.layerTest(),
    Layer.mock(ThreadLaunchService.ThreadLaunchService)({
      launch: () =>
        onLaunch.pipe(Effect.as({ threadId: ThreadId.make("thread-catch-up") } as never)),
    }),
    Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
      namedProjectsRoot: "/projects",
      isScratchProject: () => Effect.succeed(false),
    }),
    Layer.mock(ThreadManagementService.ThreadManagementService)({}),
    Layer.mock(SecretRequests.SecretRequests)({}),
  );

const firstTaskWhere = (
  service: ScheduledTaskService.ScheduledTaskService["Service"],
  predicate: (task: ScheduledTask) => boolean,
) =>
  service.subscribeList().pipe(
    Stream.map((result) => result.tasks[0]),
    Stream.filter((task): task is ScheduledTask => task !== undefined && predicate(task)),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );

// each provide is one server run; the gap between them is the app being closed.
const withService = <A, E, R>(
  program: Effect.Effect<A, E, R | ScheduledTaskService.ScheduledTaskService>,
  onLaunch: Effect.Effect<void> = Effect.void,
) =>
  program.pipe(
    Effect.provide(ScheduledTaskService.layer.pipe(Layer.provide(catchUpDependencies(onLaunch)))),
  );

it.effect("runs a catch-up slot missed earlier today once, then waits for tomorrow", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(DateTime.toEpochMillis(localTime(1, 8)));
    const launches = yield* Ref.make(0);
    const created = yield* withService(
      Effect.flatMap(ScheduledTaskService.ScheduledTaskService, (service) =>
        Effect.flatMap(catchUpInput(true), service.upsert),
      ),
    );
    expect(created.task.nextRunAt).toBe(isoAt(1, 9));

    // the app was closed through 09:00 and opens at 09:47, past the grace.
    yield* TestClock.setTime(DateTime.toEpochMillis(localTime(1, 9, 47)));
    yield* withService(
      Effect.gen(function* () {
        const service = yield* ScheduledTaskService.ScheduledTaskService;
        yield* TestClock.adjust("6 seconds");
        const ran = yield* firstTaskWhere(service, (task) => task.lastRunStatus === "succeeded");
        expect(ran.nextRunAt).toBe(isoAt(2, 9));
        yield* TestClock.adjust("6 seconds");
        expect(yield* Ref.get(launches)).toBe(1);
      }),
      Ref.update(launches, (n) => n + 1),
    );
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("skips a plain fixed-time slot missed by more than the grace", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(DateTime.toEpochMillis(localTime(1, 8)));
    yield* withService(
      Effect.flatMap(ScheduledTaskService.ScheduledTaskService, (service) =>
        Effect.flatMap(catchUpInput(false), service.upsert),
      ),
    );
    yield* TestClock.setTime(DateTime.toEpochMillis(localTime(1, 9, 47)));
    yield* withService(
      Effect.gen(function* () {
        const service = yield* ScheduledTaskService.ScheduledTaskService;
        yield* TestClock.adjust("6 seconds");
        const skipped = yield* firstTaskWhere(service, (task) => task.nextRunAt !== isoAt(1, 9));
        expect(skipped.nextRunAt).toBe(isoAt(2, 9));
        expect(skipped.lastRunStatus).toBe("never");
      }),
    );
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("brings a days-old slot back to today instead of skipping today", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(DateTime.toEpochMillis(localTime(1, 8)));
    yield* withService(
      Effect.flatMap(ScheduledTaskService.ScheduledTaskService, (service) =>
        Effect.flatMap(catchUpInput(true), service.upsert),
      ),
    );

    // three days off, back before today's slot.
    yield* TestClock.setTime(DateTime.toEpochMillis(localTime(4, 7, 52)));
    yield* withService(
      Effect.gen(function* () {
        const service = yield* ScheduledTaskService.ScheduledTaskService;
        yield* TestClock.adjust("6 seconds");
        const rescheduled = yield* firstTaskWhere(
          service,
          (task) => task.nextRunAt !== isoAt(1, 9),
        );
        expect(rescheduled.nextRunAt).toBe(isoAt(4, 9));
        expect(rescheduled.lastRunStatus).toBe("never");
      }),
    );
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("counts an early Run now as today's catch-up run but not a plain task's", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(DateTime.toEpochMillis(localTime(1, 8)));
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const catchUp = yield* service.upsert(yield* catchUpInput(true));
      const ranEarly = yield* service.runNow({ id: catchUp.task.id });
      expect(ranEarly.task.nextRunAt).toBe(isoAt(2, 9));
      // a second explicit run still goes through.
      expect((yield* service.runNow({ id: catchUp.task.id })).task.runCount).toBe(2);

      const plain = yield* service.upsert(yield* catchUpInput(false));
      expect((yield* service.runNow({ id: plain.task.id })).task.nextRunAt).toBe(isoAt(1, 9));
    }).pipe(
      Effect.provide(
        ScheduledTaskService.layer.pipe(Layer.provide(catchUpDependencies(Effect.void))),
      ),
    );
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);
