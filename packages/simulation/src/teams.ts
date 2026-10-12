import type { TeamId } from "./types.js";

export type Relationship = "FRIENDLY" | "NEUTRAL" | "HOSTILE";
export function createTeamId(value: string): TeamId {
  if (value.length === 0) throw new RangeError("team id must not be empty");
  return value as TeamId;
}
export const PLAYER_TEAM = createTeamId("players");
export const PVE_TEAM = createTeamId("pve");
export type TeamRelation = {
  readonly teams: readonly [TeamId, TeamId];
  readonly relationship: Relationship;
};

/** Match-level symmetric policy. Different unlisted teams are neutral. */
export class RelationshipPolicy {
  private readonly relations: readonly TeamRelation[];
  constructor(
    relations: readonly TeamRelation[] = [
      { teams: [PLAYER_TEAM, PVE_TEAM], relationship: "HOSTILE" },
    ],
  ) {
    this.relations = relations.map(({ teams, relationship }) => ({
      teams: [teams[0], teams[1]],
      relationship,
    }));
  }
  resolve(a: TeamId | undefined, b: TeamId | undefined): Relationship {
    if (a === undefined || b === undefined) return "NEUTRAL";
    if (a === b) return "FRIENDLY";
    return (
      this.relations.find(
        ({ teams }) => (teams[0] === a && teams[1] === b) || (teams[0] === b && teams[1] === a),
      )?.relationship ?? "NEUTRAL"
    );
  }
}
