const COLUMN_WIDTH = 240;
const ROW_HEIGHT = 96;
/**
 * React Flow custom nodes become slow once a repository reaches thousands of
 * files. The page draws at most this many internal files. Full counts stay
 * outside the picture.
 */
export const VISUAL_NODE_LIMIT = 80;
export function selectInternalVisualGraph(nodes, edges) {
    const internalEdges = edges.filter((edge) => edge.type === 'internal');
    if (nodes.length <= VISUAL_NODE_LIMIT) {
        return { nodes, edges: internalEdges, bounded: false };
    }
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const included = new Set();
    for (const edge of internalEdges) {
        if (!byId.has(edge.source) || !byId.has(edge.target))
            continue;
        const additions = [edge.source, edge.target].filter((id) => !included.has(id));
        if (included.size + additions.length > VISUAL_NODE_LIMIT)
            continue;
        additions.forEach((id) => included.add(id));
        if (included.size >= VISUAL_NODE_LIMIT)
            break;
    }
    for (const node of nodes) {
        if (included.size >= VISUAL_NODE_LIMIT)
            break;
        included.add(node.id);
    }
    const visualNodes = nodes.filter((node) => included.has(node.id));
    const visualEdges = internalEdges.filter((edge) => included.has(edge.source) && included.has(edge.target));
    return { nodes: visualNodes, edges: visualEdges, bounded: true };
}
/**
 * Assigns each node to a column based on its BFS depth from nodes with no
 * incoming edges, then stacks nodes within a column. This is only a display
 * layout for the visualization subset.
 */
export function computeLayeredLayout(nodes, edges) {
    const incoming = new Map();
    const adjacency = new Map();
    nodes.forEach((node) => {
        incoming.set(node.id, 0);
        adjacency.set(node.id, []);
    });
    edges.forEach((edge) => {
        if (!incoming.has(edge.source) || !incoming.has(edge.target))
            return;
        incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
        adjacency.get(edge.source)?.push(edge.target);
    });
    const depth = new Map();
    const roots = nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0);
    const queue = roots.length ? roots.map((node) => node.id) : nodes[0] ? [nodes[0].id] : [];
    queue.forEach((id) => depth.set(id, 0));
    let index = 0;
    while (index < queue.length) {
        const current = queue[index];
        index += 1;
        const currentDepth = depth.get(current) ?? 0;
        (adjacency.get(current) ?? []).forEach((next) => {
            if (!depth.has(next) || (depth.get(next) ?? 0) < currentDepth + 1) {
                depth.set(next, currentDepth + 1);
            }
            if (!queue.includes(next))
                queue.push(next);
        });
    }
    nodes.forEach((node) => {
        if (!depth.has(node.id))
            depth.set(node.id, Math.max(0, ...Array.from(depth.values())) + 1);
    });
    const columns = new Map();
    nodes.forEach((node) => {
        const column = depth.get(node.id) ?? 0;
        const ids = columns.get(column) ?? [];
        ids.push(node.id);
        columns.set(column, ids);
    });
    const positions = {};
    columns.forEach((ids, column) => {
        const columnHeight = ids.length * ROW_HEIGHT;
        ids.forEach((id, row) => {
            positions[id] = {
                x: column * COLUMN_WIDTH,
                y: row * ROW_HEIGHT - columnHeight / 2,
            };
        });
    });
    return positions;
}
