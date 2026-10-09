import { expectTypeOf, it } from "vitest";
import { commandPathCost } from "./command-scheduler.js";
import type { SimulationCommand } from "./commands.js";

type FutureCommand =
  | SimulationCommand
  | { readonly type: "GATHER"; readonly workerId: number }
  | { readonly type: "BUILD"; readonly builderId: number }
  | { readonly type: "GARRISON"; readonly unitId: number }
  | { readonly type: "UNGARRISON"; readonly buildingId: number };

it("accepts a future command union without requiring entityIds on non-MOVE variants", () => {
  expectTypeOf<FutureCommand>().toExtend<Parameters<typeof commandPathCost>[0]>();
  expectTypeOf(commandPathCost).returns.toEqualTypeOf<number>();
  // @ts-expect-error MOVE alone still requires entityIds.
  commandPathCost({ type: "MOVE" });
  // @ts-expect-error Arbitrary future kinds must explicitly acquire a cost contract.
  commandPathCost({ type: "ATTACK" });
});
