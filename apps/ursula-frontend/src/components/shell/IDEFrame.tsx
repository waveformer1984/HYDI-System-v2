/**
 * IDEFrame — Main VS Code-style shell layout
 * 
 * Composes ActivityBar, TabBar, StatusBar, and module content area
 * into a full-screen IDE frame. Manages module tab state.
 * 
 * Usage: Drop into page.tsx as the sole child.
 * Config: Modules registered in src/lib/modules.ts appear automatically.
 */
'use client';

import { useState, useEffect } from 'react';
import { Sparkles } from 'lucide-react';
import { useModules } from '@/lib/use-modules';
import ActivityBar from './ActivityBar';
import TabBar from './TabBar';
import StatusBar from './StatusBar';
import OverviewModule from '@/components/modules/OverviewModule';
import AgentsModule from '@/components/modules/AgentsModule';
import PaymentsModule from '@/components/modules/PaymentsModule';
import SiteGradeModule from '@/components/modules/SiteGradeModule';
import TerminalModule from '@/components/modules/TerminalModule';
import IdeaWorkshopModule from '@/components/modules/IdeaWorkshopModule';
import SituationRoomModule from '@/components/modules/SituationRoomModule';
import ConceptMatrixModule from '@/components/modules/ConceptMatrixModule';
import BrandingModule from '@/components/modules/BrandingModule';
import RezonetteModule from '@/components/modules/RezonetteModule';
import InventoryModule from '@/components/modules/InventoryModule';
import SketchPadModule from '@/components/modules/SketchPadModule';
import NodeMeshModule from '@/components/modules/NodeMeshModule';
import GhostwriterModule from '@/components/modules/GhostwriterModule';
import ProjectOpsModule from '@/components/modules/ProjectOpsModule';
import OrchestrationModule from '@/components/modules/OrchestrationModule';
import CyberServicesModule from '@/components/modules/CyberServicesModule';
import FundingHubModule from '@/components/modules/FundingHubModule';
import BuildAMindModule from '@/components/modules/BuildAMindModule';
import HydiTacticalModule from '@/components/modules/HydiTacticalModule';
import ZAeroModule from '@/components/modules/ZAeroModule';
import FreelanceModule from '@/components/modules/FreelanceModule';
import CheckpointEchoModule from '@/components/modules/CheckpointEchoModule';
import LLMModule from '@/components/modules/LLMModule';
import AutomationModule from '@/components/modules/AutomationModule';
import ResendModule from '@/components/modules/ResendModule';
import UrsulaSalesModule from '@/components/modules/UrsulaSalesModule';
import PlatformCLIModule from '@/components/modules/PlatformCLIModule';
import ProtoForgeRoadmapModule from '@/components/modules/ProtoForgeRoadmapModule';
import RoadmapEmbed from '@/components/modules/RoadmapEmbed';
import TaskPipelineModule from '@/components/modules/TaskPipelineModule';
import HYDIModule from '@/components/modules/HYDIModule';
import UrsulaBotModule from '@/components/modules/UrsulaBotModule';
import AppLauncherModule from '@/components/modules/AppLauncherModule';
import TaskGeneratorModule from '@/components/modules/TaskGeneratorModule';
import AgentTaskExecutorModule from '@/components/modules/AgentTaskExecutorModule';
import LaunchInventoryModule from '@/components/modules/LaunchInventoryModule';
import AppGroupsModule from '@/components/modules/AppGroupsModule';
import RezonateDAWModule from '@/components/modules/RezonateDAWModule';
import ColtersCommandModule from '@/components/modules/ColtersCommandModule';
import ColtersMobileModule from '@/components/modules/ColtersMobileModule';
import SmokehouseOperationsModule from '@/components/modules/SmokehouseOperationsModule';
import CulturesModule from '@/components/modules/CulturesModule';
import UrsulaCopilot from '@/components/copilot/UrsulaCopilot';
import FloatingCopilot from '@/components/copilot/FloatingCopilot';

const MODULE_COMPONENTS: Record<string, React.FC> = {
  overview: OverviewModule,
  agents: AgentsModule,
  payments: PaymentsModule,
  sitegrade: SiteGradeModule,
  terminal: TerminalModule,
  ideas: IdeaWorkshopModule,
  situation: SituationRoomModule,
  concepts: ConceptMatrixModule,
  branding: BrandingModule,
  rezonette: RezonateDAWModule,
  inventory: InventoryModule,
  sketchpad: SketchPadModule,
  nodes: NodeMeshModule,
  ghostwriter: GhostwriterModule,
  projectops: ProjectOpsModule,
  orchestration: OrchestrationModule,
  cyber: CyberServicesModule,
  funding: FundingHubModule,
  buildamind: BuildAMindModule,
  tactical: HydiTacticalModule,
  zaero: ZAeroModule,
  freelance: FreelanceModule,
  checkpoints: CheckpointEchoModule,
  llm: LLMModule,
  automation: AutomationModule,
  resend: ResendModule,
  ursula: UrsulaSalesModule,
  platformcli: PlatformCLIModule,
  roadmap: RoadmapEmbed,
  taskpipeline: TaskPipelineModule,
  hydi: HYDIModule,
  ursula_bot: UrsulaBotModule,
  applauncher: AppLauncherModule,
  taskgen: TaskGeneratorModule,
  agentexec: AgentTaskExecutorModule,
  appgroups: AppGroupsModule,
  launchinventory: LaunchInventoryModule,
  'colters-command': ColtersCommandModule,
  'colters-mobile': ColtersMobileModule,
  smokehouse: SmokehouseOperationsModule,
  cultures: CulturesModule,
  copilot: UrsulaCopilot,
};

export default function IDEFrame() {
  const { modules, openTabs, activeTab, openModule, closeTab, setActive } = useModules();
  const [isFloatingCopilotVisible, setIsFloatingCopilotVisible] = useState(false);

  // Keyboard shortcut for floating copilot (Ctrl/Cmd + Shift + C)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        setIsFloatingCopilotVisible(!isFloatingCopilotVisible);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isFloatingCopilotVisible]);

  const ActiveComponent = activeTab ? MODULE_COMPONENTS[activeTab] : null;

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden select-none">
      {/* Title Bar */}
      <div
        className="flex items-center justify-between px-4 shrink-0"
        style={{
          height: 30,
          background: 'var(--bg-titlebar)',
          borderBottom: '1px solid var(--border-color)',
        }}
      >
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <span className="w-3 h-3 rounded-full" style={{ background: '#f85149' }} />
            <span className="w-3 h-3 rounded-full" style={{ background: '#d29922' }} />
            <span className="w-3 h-3 rounded-full" style={{ background: '#3fb950' }} />
          </div>
          <button
            onClick={() => setIsFloatingCopilotVisible(!isFloatingCopilotVisible)}
            className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors flex items-center space-x-1"
            title={isFloatingCopilotVisible ? "Hide Floating Copilot (Ctrl+Shift+C)" : "Show Floating Copilot (Ctrl+Shift+C)"}
          >
            <Sparkles className="w-3 h-3" />
            <span>Copilot</span>
          </button>
        </div>
        <span
          className="text-[11px] font-mono absolute left-1/2 -translate-x-1/2"
          style={{ color: 'var(--text-secondary)' }}
        >
          Ursula — ProtoForge Hub
        </span>
        <div />
      </div>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Activity Bar */}
        <ActivityBar
          modules={modules}
          activeTab={activeTab}
          onModuleClick={openModule}
          onSettingsClick={() => {/* TODO: settings panel */ }}
        />

        {/* Editor Area */}
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Tab Bar */}
          <TabBar
            tabs={openTabs}
            activeTab={activeTab}
            onTabClick={setActive}
            onTabClose={closeTab}
          />

          {/* Module Content */}
          <div className="flex-1 overflow-hidden">
            {ActiveComponent ? (
              <ActiveComponent />
            ) : (
              <WelcomeScreen onOpenModule={openModule} />
            )}
          </div>
        </div>
      </div>

      {/* Status Bar */}
      <StatusBar
        activeModule={activeTab ? modules.find(m => m.id === activeTab)?.label ?? null : null}
      />

      {/* Floating Copilot */}
      <FloatingCopilot
        isVisible={isFloatingCopilotVisible}
        onClose={() => setIsFloatingCopilotVisible(false)}
        onMinimize={() => setIsFloatingCopilotVisible(false)}
      />
    </div>
  );
}

/** Shown when no tabs are open */
function WelcomeScreen({ onOpenModule }: { onOpenModule: (id: string) => void }) {
  return (
    <div
      className="h-full flex flex-col items-center justify-center gap-6"
      style={{ background: 'var(--bg-editor)' }}
    >
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-active)' }}>
          Ursula
        </h2>
        <p className="text-sm font-mono" style={{ color: 'var(--text-secondary)' }}>
          ProtoForge Command Center v0.1.0
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {[
          { id: 'overview', label: 'Open Overview', key: 'Ctrl+1' },
          { id: 'agents', label: 'Open Agents', key: 'Ctrl+2' },
          { id: 'payments', label: 'Open Payments', key: 'Ctrl+3' },
          { id: 'terminal', label: 'Open Terminal', key: 'Ctrl+`' },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => onOpenModule(item.id)}
            className="flex items-center justify-between gap-8 px-4 py-2 rounded text-sm font-mono transition-colors hover:bg-white/5"
            style={{ color: 'var(--text-accent)' }}
          >
            <span>{item.label}</span>
            <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              {item.key}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
