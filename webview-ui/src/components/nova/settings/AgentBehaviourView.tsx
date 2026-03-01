// novacode_change - new file
import { useState } from "react"
import styled from "styled-components"
import { Users2 } from "lucide-react"
import { getDefaultVcpConfig, type VcpConfig } from "@roo-code/types"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { SectionHeader } from "@src/components/settings/SectionHeader"
import { Section } from "@src/components/settings/Section"
import { AgentTeamSettings } from "@src/components/settings/AgentTeamSettings"
import ModesView from "@src/components/modes/ModesView"
import McpView from "@src/components/mcp/McpView"
import NovaRulesWorkflowsView from "@src/components/nova/rules/NovaRulesWorkflowsView"
import InstalledSkillsView from "@src/components/nova/settings/InstalledSkillsView"

type DeepPartial<T> = {
	[K in keyof T]?: T[K] extends Array<infer U> ? Array<U> : T[K] extends object ? DeepPartial<T[K]> : T[K]
}

type AgentBehaviourViewProps = {
	vcpConfig?: VcpConfig
	onUpdateVcpConfig: (patch: DeepPartial<VcpConfig>) => void
}

const StyledTabButton = styled.button<{ isActive: boolean }>`
	background: none;
	border: none;
	border-bottom: 2px solid ${(props) => (props.isActive ? "var(--vscode-foreground)" : "transparent")};
	color: ${(props) => (props.isActive ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)")};
	padding: 8px 16px;
	cursor: pointer;
	font-size: 13px;
	margin-bottom: -1px;
	font-family: inherit;

	&:hover {
		color: var(--vscode-foreground);
	}
`

const TabButton = ({
	children,
	isActive,
	onClick,
}: {
	children: React.ReactNode
	isActive: boolean
	onClick: () => void
}) => (
	<StyledTabButton isActive={isActive} onClick={onClick}>
		{children}
	</StyledTabButton>
)

const AgentBehaviourView = ({ vcpConfig, onUpdateVcpConfig }: AgentBehaviourViewProps) => {
	const [activeTab, setActiveTab] = useState<"modes" | "mcp" | "rules" | "workflows" | "skills" | "agentTeam">(
		"modes",
	)
	const { t } = useAppTranslation()
	const currentVcpConfig = vcpConfig ?? getDefaultVcpConfig()

	return (
		<div>
			<SectionHeader>
				<div className="flex items-center gap-2">
					<Users2 className="w-4" />
					<div>{t("novacode:settings.sections.agentBehaviour")}</div>
				</div>
			</SectionHeader>

			<Section>
				{/* Tab buttons */}
				<div className="flex flex-wrap gap-[1px] px-5 border-b border-vscode-panel-border">
					<TabButton isActive={activeTab === "modes"} onClick={() => setActiveTab("modes")}>
						{t("settings:sections.modes")}
					</TabButton>
					<TabButton isActive={activeTab === "mcp"} onClick={() => setActiveTab("mcp")}>
						{t("novacode:settings.sections.mcp")}
					</TabButton>
					<TabButton isActive={activeTab === "rules"} onClick={() => setActiveTab("rules")}>
						{t("novacode:rules.tabs.rules")}
					</TabButton>
					<TabButton isActive={activeTab === "workflows"} onClick={() => setActiveTab("workflows")}>
						{t("novacode:rules.tabs.workflows")}
					</TabButton>
					<TabButton isActive={activeTab === "skills"} onClick={() => setActiveTab("skills")}>
						{t("novacode:settings.sections.skills")}
					</TabButton>
					<TabButton isActive={activeTab === "agentTeam"} onClick={() => setActiveTab("agentTeam")}>
						Agent Team
					</TabButton>
				</div>

				{/* Content */}
				<div className="w-full">
					{activeTab === "modes" && <ModesView hideHeader />}
					{activeTab === "mcp" && <McpView hideHeader onDone={() => {}} />}
					{activeTab === "rules" && <NovaRulesWorkflowsView type="rule" />}
					{activeTab === "workflows" && <NovaRulesWorkflowsView type="workflow" />}
					{activeTab === "skills" && <InstalledSkillsView />}
					{activeTab === "agentTeam" && (
						<AgentTeamSettings vcpConfig={currentVcpConfig} onUpdateVcpConfig={onUpdateVcpConfig} />
					)}
				</div>
			</Section>
		</div>
	)
}

export default AgentBehaviourView
