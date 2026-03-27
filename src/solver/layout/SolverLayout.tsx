import { log } from '@/core/logger/log';
import { useStore } from '@/core/zustand';
import type { SolutionNode } from '@/solver/algorithm/solveProduction';
import { FloatingEdge } from '@/solver/edges/FloatingEdge';
import { IngredientEdge } from '@/solver/edges/IngredientEdge';
import type { SolverLayoutState, SolverNodeState } from '@/solver/store/Solver';
import { usePathSolverLayout } from '@/solver/store/solverSelectors';
import { toggleFullscreen } from '@/utils/toggleFullscreen.tsx';
import ELK from 'elkjs/lib/elk.bundled.js';
import { useSolverSolution } from '@/solver/layout/solution-context/SolverSolutionContext';
import { LoadingOverlay, Stack, Text, Loader, Box } from '@mantine/core';
import { IconArrowsMaximize, IconMaximizeOff } from '@tabler/icons-react';
import type { SolverEnergyNode, SolverAreaNode } from '@/solver/algorithm/SolverNode';
import { RepeatingNumber } from '@/core/intl/NumberFormatter';
import type { IMachineNodeData } from '@/solver/layout/nodes/machine-node/MachineNode';
import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  ControlButton,
  Controls,
  Edge,
  InternalNode,
  MiniMap,
  Node,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  type OnNodesChange,
  type OnSelectionChangeFunc,
  type XYPosition,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { isEqual } from 'lodash';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ByproductNode } from './nodes/byproduct-node/ByproductNode';
import { MachineNode } from './nodes/machine-node/MachineNode';
import { ResourceNode } from './nodes/resource-node/ResourceNode';
import classes from './SolverLayout.module.css';
import {
  areSavedLayoutsCompatible,
  areSolverLayoutsEqual,
  computeSolverLayout,
  isSavedLayoutValid,
} from './state/savedSolverLayoutUtils';
import { updateNodesWithLayoutState } from './state/updateNodesWithLayoutState';
import { usePreviousSolverLayoutStates } from './state/usePreviousSolverLayoutStates';

const elk = new ELK();
const logger = log.getLogger('solver:layout');
logger.setLevel('info');

const snapValueToGrid = (value: number) => Math.round(value / 10) * 10;
const snapSizeToGrid = (value: number) => Math.round(value / 20) * 20;

function getNodeComputedPosition(
  layoutNode: { x?: number; y?: number },
  node: SolutionNode,
  nodeSavedPosition: XYPosition | undefined,
): XYPosition {
  if (nodeSavedPosition) {
    return {
      x: nodeSavedPosition.x,
      y: nodeSavedPosition.y,
    };
  }

  // ELK node coordinates are top-left by default, matching React Flow perfectly!
  return {
    x: snapValueToGrid(layoutNode.x ?? 0),
    y: snapValueToGrid(layoutNode.y ?? 0),
  };
}

/**
 * @prop activeLayout - The layout state to use. If null, the layout will be computed. Could be
 *  used to restore a previous layout.
 */
const getLayoutedElements = async (
  nodes: SolutionNode[],
  edges: Edge[],
  activeLayout: SolverLayoutState | null | undefined,
) => {
  const useSavedLayout = activeLayout != null;
  logger.debug(`getLayouted: useSavedLayout=${useSavedLayout}`);

  const filteredEdges = edges.filter(
    edge =>
      !(
        (nodes.find(n => n.id === edge.source)?.data?.state as SolverNodeState)
          ?.layoutIgnoreEdges ||
        (nodes.find(n => n.id === edge.target)?.data?.state as SolverNodeState)
          ?.layoutIgnoreEdges
      ),
  );

  let elkGraph: any = null;

  if (!useSavedLayout) {
    const graphLayer = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.spacing.nodeNode': '100',
        'elk.layered.spacing.nodeNodeBetweenLayers': '300',
        'elk.layered.spacing.edgeNodeBetweenLayers': '80',
        'elk.layered.spacing.edgeEdgeBetweenLayers': '20',
        'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
        'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      },
      children: nodes.map(node => ({
        id: node.id,
        width: snapSizeToGrid(node.measured?.width ?? 0),
        height: snapSizeToGrid(node.measured?.height ?? 0),
      })),
      edges: filteredEdges.map(edge => ({
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target],
      })),
    };

    elkGraph = await elk.layout(graphLayer);
  }

  const isHorizontal = true; // Hardcoded LR layout

  const newNodes: SolutionNode[] = (nodes as InternalNode<SolutionNode>[]).map(
    node => {
      let layoutX = 0;
      let layoutY = 0;

      if (!useSavedLayout && elkGraph?.children) {
        const elkNode = elkGraph.children.find((n: any) => n.id === node.id);
        layoutX = elkNode?.x ?? 0;
        layoutY = elkNode?.y ?? 0;
      }

      const nodePosition = getNodeComputedPosition(
        { x: layoutX, y: layoutY },
        node,
        useSavedLayout ? activeLayout[node.id] : undefined,
      );

      const newNode: any = {
        ...node,
        targetPosition: isHorizontal ? Position.Left : Position.Top,
        sourcePosition: isHorizontal ? Position.Right : Position.Bottom,

        position: nodePosition,
      };
      
      return newNode as unknown as SolutionNode;
    },
  );

  return { nodes: newNodes, edges: filteredEdges };
};

interface SolverLayoutProps {
  nodes: SolutionNode[];
  edges: Edge[];
  children?: React.ReactNode;
}

const nodeTypes = {
  Machine: MachineNode,
  Resource: ResourceNode,
  Byproduct: ByproductNode,
};

const edgeTypes = {
  Floating: FloatingEdge,
  Ingredient: IngredientEdge,
};

export const SolverLayout = (props: SolverLayoutProps) => {
  const solverId = useParams<{ id: string }>().id;
  const savedLayout = usePathSolverLayout();
  const { fitView, getNodes, getEdges } = useReactFlow<SolutionNode, Edge>();

  const [nodes, setNodes, onNodesChange] = useNodesState(props.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(props.edges);
  const [isLayouting, setIsLayouting] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Set CSS variable imperatively on the container — zero React re-renders for edge dimming
  const onSelectionChange: OnSelectionChangeFunc = useCallback(({ nodes: selNodes }) => {
    if (ref.current) {
      ref.current.style.setProperty(
        '--edge-dim-opacity',
        selNodes.length > 0 ? '0.12' : '1',
      );
    }
  }, [ref]);

  const nodesInitialized = useNodesInitialized();
  const [initialLayoutFinished, setInitialLayoutFinished] = useState(false);
  const [initialFitViewFinished, setInitialFitViewFinished] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Stats for loading overlay
  const solutionContext = useSolverSolution();
  const solution = solutionContext?.solution;

  const stats = useMemo(() => {
    if (!solution) return { power: 0, area: 0 };
    const machineNodes = solution.nodes.filter(
      (node): node is Node<IMachineNodeData, 'Machine'> =>
        node.type === 'Machine',
    );
    const power = machineNodes.reduce((acc, node) => {
      const energyNode = solution.graph.getNodeAttributes(`e${node.data.recipe.index}`) as SolverEnergyNode;
      return acc + (energyNode.value ?? 0);
    }, 0);
    const area = machineNodes.reduce((acc, node) => {
      const areaNode = solution.graph.getNodeAttributes(`area${node.data.recipe.index}`) as SolverAreaNode;
      return acc + (areaNode.value ?? 0);
    }, 0);
    return { power, area };
  }, [solution]);

  const handleToggleFullscreen = () => {
    toggleFullscreen(ref);
  };

  const handleFullscreenChange = () => {
    setIsFullscreen(document.fullscreenElement === ref.current);
  };

  useEffect(() => {
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const previousFittedWithNodes = useRef(false);

  // When nodes change, we need to re-layout them.
  useEffect(() => {
    logger.debug('Initializing nodes...');

    // Force re-fit view if nodes change
    // TODO better to do a xor-ing of nodes
    if (props.nodes.length !== getNodes().length) {
      previousFittedWithNodes.current = false;
    }

    // We don't want `savedLayout` to be a dependency, just to use
    // the latest value when the nodes change.
    setNodes([...updateNodesWithLayoutState(props.nodes, savedLayout)]);
    setEdges([...props.edges]);
    setInitialLayoutFinished(false);
    setInitialFitViewFinished(false);

    // setTimeout(() => {}, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.edges, props.nodes, setEdges, setNodes]);

  const { getCompatiblePreviousLayout, cachePreviousLayout } =
    usePreviousSolverLayoutStates();

  useEffect(() => {
    // We can't trust `nodesInitialized` to be true, because it's updated later in the loop.
    // We need to check if the nodes have real measurements.
    const visibleNodes = nodes.filter(n => !n.hidden);
    const isMeasured =
      nodesInitialized &&
      (visibleNodes.length === 0 || (visibleNodes[0]?.measured?.width && visibleNodes[0]?.measured?.height));

    // logger.debug(`Check for re-layout: nodesInitialized=${nodesInitialized}, initialLayoutFinished=${initialLayoutFinished} hasRealMeasurements=${isMeasured}`); // prettier-ignore

    const shouldRelayout =
      isMeasured && (!initialLayoutFinished || savedLayout == null);

    if (shouldRelayout && !isLayouting) {
      logger.info(`-> Layouting (initial layout in progress)`); // prettier-ignore
      setIsLayouting(true);

      const activeLayout =
        savedLayout == null
          ? null
          : isSavedLayoutValid(nodes, savedLayout)
            ? savedLayout
            : getCompatiblePreviousLayout(nodes);

      getLayoutedElements(
        getNodes(),
        getEdges(),
        activeLayout,
      ).then(layouted => {
        setNodes([...layouted.nodes]);
        setEdges([...layouted.edges]);
        setInitialLayoutFinished(true);
        setIsLayouting(false);

        // Re-fit view if the layout has been reset
        if (savedLayout == null) {
          setInitialFitViewFinished(false);
        }

        const computedLayout = computeSolverLayout(layouted.nodes);
        if (!areSolverLayoutsEqual(savedLayout, computedLayout)) {
          logger.debug('-> Updating saved layout');
          useStore.getState().setSolverLayout(solverId!, computedLayout);
        }
      }).catch(err => {
        logger.error('Layout mapping failed', err);
        setIsLayouting(false);
      });
    }

    // 2. Nodes are initialized and layouted, so we can fit the view.
    if (isMeasured && initialLayoutFinished && !initialFitViewFinished && !isLayouting) {
      logger.debug('-> Fitting view...');
      setInitialFitViewFinished(true);
      if (nodes.length > 0 && !previousFittedWithNodes.current) {
        previousFittedWithNodes.current = true;
        fitView().then(() => {
          logger.debug('-> Fitting view completed');
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    nodesInitialized,
    savedLayout,
    initialLayoutFinished,
    initialFitViewFinished,
    getCompatiblePreviousLayout,
    isLayouting
  ]);

  /**
   * On nodes change, we need to update the layout state and
   * save it.
   * If the layout is not valid (all zeros), we don't save it since
   * this means the layout is not initialized yet.
   */
  const handleNodesChange: OnNodesChange<SolutionNode> = useCallback(
    changes => {
      onNodesChange(changes);

      // Only persist layout when a drag ends (not during every mouse-move)
      const hasDragStop = changes.some(
        c => c.type === 'position' && !c.dragging
      );
      if (!hasDragStop) return;

      const updatedLayout = computeSolverLayout(getNodes());

      if (Object.values(updatedLayout).every(p => p.x == 0 && p.y == 0)) return;

      if (!isEqual(updatedLayout, savedLayout)) {
        if (areSavedLayoutsCompatible(updatedLayout, savedLayout)) {
          useStore.getState().setSolverLayout(solverId!, updatedLayout);
        } else if (savedLayout != null) {
          cachePreviousLayout(savedLayout);
        }
      }
    },
    [cachePreviousLayout, getNodes, onNodesChange, savedLayout, solverId],
  );

  // Context menu
  // const onNodeContextMenu = useCallback(
  //   (event: React.MouseEvent, node: Node) => {
  //     // Prevent native context menu from showing
  //     event.preventDefault();

  //     // Calculate position of the context menu. We want to make sure it
  //     // doesn't get positioned off-screen.
  //     const pane = ref.current!.getBoundingClientRect();
  //     setMenu({
  //       id: node.id,
  //       top: event.clientY < pane.height - 200 && event.clientY,
  //       left: event.clientX < pane.width - 200 && event.clientX,
  //       right: event.clientX >= pane.width - 200 && pane.width - event.clientX,
  //       bottom:
  //         event.clientY >= pane.height - 200 && pane.height - event.clientY,
  //     });
  //   },
  //   [setMenu],
  // );

  const loaderData = (
    <Stack align="center" gap="sm">
      <Loader size="lg" />
      <Text size="lg" fw={500}>Calculating Optimal Layout...</Text>
      {solution && (
        <Text size="sm" c="dimmed" ta="center">
          Placing {props.nodes.length} nodes and routing {props.edges.length} connections
          <br/>
          Power: <RepeatingNumber value={stats.power} /> MW | Area: <RepeatingNumber value={stats.area} /> m²
        </Text>
      )}
    </Stack>
  );

  return (
    <Box w={'100%'} h={'80vh'} pos="relative">
      <LoadingOverlay
         visible={isLayouting || !initialFitViewFinished}
         zIndex={100}
         overlayProps={{ radius: 'sm', blur: 3, backgroundOpacity: 0.8, color: 'var(--mantine-color-body)' }}
         loaderProps={{ children: loaderData }}
      />
      <ReactFlow
        ref={ref}
        minZoom={0.2}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onSelectionChange={onSelectionChange}
        connectionLineType={ConnectionLineType.SmoothStep}
        selectNodesOnDrag={false}
        // onNodeContextMenu={onNodeContextMenu}
        fitView
        snapToGrid
        colorMode="dark"
        proOptions={{
          hideAttribution: true,
        }}
        snapGrid={[10, 10]}
      >
        <Controls showFitView>
          <ControlButton
            onClick={handleToggleFullscreen}
            aria-label="toggle fullscreen"
            title="toggle fullscreen"
            className={classes.fullscreenButton}
          >
            {isFullscreen ? <IconMaximizeOff /> : <IconArrowsMaximize />}
          </ControlButton>
        </Controls>
        <MiniMap pannable={true} nodeStrokeWidth={3} />

        <svg>
          <defs>
            <linearGradient id="edge-gradient">
              <stop offset="0%" stopColor="var(--mantine-color-gray-7)" />
              <stop offset="100%" stopColor="var(--mantine-color-gray-4)" />
            </linearGradient>
            <linearGradient id="edge-gradient-reverse">
              <stop offset="0%" stopColor="var(--mantine-color-gray-4)" />
              <stop offset="100%" stopColor="var(--mantine-color-gray-7)" />
            </linearGradient>

            <marker
              id="edge-circle"
              viewBox="-5 -5 10 10"
              refX="0"
              refY="0"
              markerUnits="strokeWidth"
              markerWidth="10"
              markerHeight="10"
              orient="auto"
            >
              <circle
                stroke="#2a8af6"
                strokeOpacity="0.75"
                r="2"
                cx="0"
                cy="0"
              />
            </marker>
          </defs>
        </svg>
        <Background
          bgColor="var(--mantine-color-dark-7)"
          color="var(--mantine-color-dark-4)"
          variant={BackgroundVariant.Dots}
          gap={[10, 10]}
        />
        {props.children}
        {/* <Panel>{/* <Button onClick={onLayout}>Layout</Button> </Panel> */}
      </ReactFlow>
    </Box>
  );
};
