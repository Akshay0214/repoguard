import { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  BackgroundVariant,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { computeLayeredLayout } from './graphLayout';
import { DependencyNodeCard } from './DependencyNodeCard';
import type { DependencyRelation } from '@/services/repositoryService';

const nodeTypes = { dependency: DependencyNodeCard };

export function DependencyGraph({
  nodes: fileNodes,
  edges: fileEdges,
  selectedId,
  onSelect,
}: {
  nodes: { id: string }[];
  edges: DependencyRelation[];
  selectedId: string | null;
  onSelect: (path: string) => void;
}) {
  const positions = useMemo(
    () => computeLayeredLayout(fileNodes, fileEdges),
    [fileNodes, fileEdges],
  );

  const nodes: Node[] = useMemo(
    () =>
      fileNodes.map((node) => ({
        id: node.id,
        type: 'dependency',
        position: positions[node.id] ?? { x: 0, y: 0 },
        data: { path: node.id },
        selected: node.id === selectedId,
      })),
    [fileNodes, positions, selectedId],
  );

  const edges: Edge[] = useMemo(
    () =>
      fileEdges.map((edge, index) => ({
        id: `${edge.source}\0${edge.target}\0${edge.kind}\0${edge.importSpecifier}\0${index}`,
        source: edge.source,
        target: edge.target,
        animated: false,
        style: { stroke: 'var(--color-border-strong)', strokeWidth: 1.4, opacity: 0.7 },
      })),
    [fileEdges],
  );

  return (
    <div className="h-[560px] w-full overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-raised)]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => onSelect(node.id)}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.15}
        maxZoom={1.5}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--color-border)" />
        <Controls
          showInteractive={false}
          className="!rounded-md !border !border-[var(--color-border)] !bg-[var(--color-surface)] [&_button]:!border-[var(--color-border)] [&_button]:!bg-[var(--color-surface)] [&_button]:!text-[var(--color-text-muted)] [&_button:hover]:!bg-[var(--color-surface-hover)]"
        />
      </ReactFlow>
    </div>
  );
}
