export interface AgentSkill { readonly name: string; readonly description: string; readonly body: string; }
export declare function renderAgentSkillMarkdown(skill: AgentSkill): string;
export declare function writeAgentSkill(input: AgentSkill & { root: string; directory?: string; mode?: "create" | "replace" | "upsert" }): Promise<{ readonly path: string; readonly text: string; readonly changed: boolean; readonly created: boolean }>;
