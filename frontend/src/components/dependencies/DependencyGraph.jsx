import { useMemo } from 'react';
import { ReactFlow, Background, Controls, BackgroundVariant, } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { computeLayeredLayout } from './graphLayout';
import { DependencyNodeCard } from './DependencyNodeCard';
const nodeTypes = { dependency: DependencyNodeCard };
export function DependencyGraph({ nodes: fileNodes, edges: fileEdges, selectedId, onSelect, className = '', }) {
    const positions = useMemo(() => computeLayeredLayout(fileNodes, fileEdges), [fileNodes, fileEdges]);
    const nodes = useMemo(() => fileNodes.map((node) => ({
        id: node.id,
        type: 'dependency',
        position: positions[node.id] ?? { x: 0, y: 0 },
        data: { path: node.id },
        selected: node.id === selectedId,
    })), [fileNodes, positions, selectedId]);
    const edges = useMemo(() => fileEdges.map((edge, index) => ({
        id: `${edge.source}\0${edge.target}\0${edge.kind}\0${edge.importSpecifier}\0${index}`,
        source: edge.source,
        target: edge.target,
        animated: false,
        style: { stroke: 'var(--color-border-strong)', strokeWidth: 1.4, opacity: 0.7 },
    })), [fileEdges]);
    return (<div className={`h-[min(70vh,520px)] min-h-[280px] w-full overflow-hidden bg-[var(--color-bg)] sm:h-[520px] ${className}`}>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodeClick={(_, node) => onSelect(node.id)} fitView fitViewOptions={{ padding: 0.25 }} proOptions={{ hideAttribution: true }} minZoom={0.15} maxZoom={1.5}>
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--color-border)"/>
        <Controls showInteractive={false} className="!rounded-md !border !border-[var(--color-border)] !bg-[var(--color-surface)] [&_button]:!border-[var(--color-border)] [&_button]:!bg-[var(--color-surface)] [&_button]:!text-[var(--color-text-muted)] [&_button:hover]:!bg-[var(--color-surface-hover)]"/>
      </ReactFlow>
    </div>);
}
