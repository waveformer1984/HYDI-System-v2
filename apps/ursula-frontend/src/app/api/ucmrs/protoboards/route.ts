import { NextRequest, NextResponse } from 'next/server';
import { Protoboard, CreateProtoboardRequest } from '@/lib/ucmrs/types';

// Mock database - replace with actual DB connection
const protoboards: Protoboard[] = [];
let nextId = 1;

// GET /api/ucmrs/protoboards - List all protoboards
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const boardId = searchParams.get('boardId');

  if (boardId) {
    const board = protoboards.find(p => p.board_id === boardId);
    if (!board) {
      return NextResponse.json({ error: 'Protoboard not found' }, { status: 404 });
    }
    return NextResponse.json({ protoboard: board });
  }

  return NextResponse.json({ protoboards });
}

// POST /api/ucmrs/protoboards - Create new protoboard entry
export async function POST(request: NextRequest) {
  try {
    const body: CreateProtoboardRequest = await request.json();

    // Validate required fields
    if (!body.board_id || !body.linked_components || body.linked_components.length === 0) {
      return NextResponse.json(
        { error: 'Missing required fields: board_id, linked_components' },
        { status: 400 }
      );
    }

    // Check for duplicate board_id
    if (protoboards.find(p => p.board_id === body.board_id)) {
      return NextResponse.json(
        { error: 'Board ID already exists' },
        { status: 409 }
      );
    }

    // Determine next action based on validation status
    const nextAction = determineNextAction(body);

    const newProtoboard: Protoboard = {
      id: (nextId++).toString(),
      board_id: body.board_id,
      linked_components: body.linked_components,
      voltage_stable: body.voltage_stable,
      current_draw_logged: body.current_draw_logged,
      noise_level: body.noise_level,
      crosstalk_risk: body.crosstalk_risk,
      connection_map_documented: body.connection_map_documented,
      detected: body.detected,
      address_stable: body.address_stable,
      failure_points: body.failure_points,
      next_action: nextAction,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    protoboards.push(newProtoboard);

    return NextResponse.json({
      protoboard: newProtoboard,
      recommendation: `Next action: ${nextAction}. ${getNextActionExplanation(nextAction)}`
    }, { status: 201 });

  } catch (error) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }
}

// PUT /api/ucmrs/protoboards - Update protoboard status (id in body)
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const id = body.id as string;
    const boardIndex = protoboards.findIndex(p => p.id === id);

    if (boardIndex === -1) {
      return NextResponse.json(
        { error: 'Protoboard not found' },
        { status: 404 }
      );
    }

    const board = protoboards[boardIndex];
    const updatedBoard = {
      ...board,
      ...body,
      updated_at: new Date().toISOString()
    };

    // Recalculate next action
    updatedBoard.next_action = determineNextAction(updatedBoard);

    protoboards[boardIndex] = updatedBoard;

    return NextResponse.json({
      protoboard: updatedBoard,
      recommendation: `Next action: ${updatedBoard.next_action}. ${getNextActionExplanation(updatedBoard.next_action)}`
    });

  } catch (error) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }
}

// DELETE /api/ucmrs/protoboards - Remove protoboard (id in query)
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id') || '';
  const boardIndex = protoboards.findIndex(p => p.id === id);

  if (boardIndex === -1) {
    return NextResponse.json(
      { error: 'Protoboard not found' },
      { status: 404 }
    );
  }

  const board = protoboards[boardIndex];
  protoboards.splice(boardIndex, 1);

  return NextResponse.json({
    message: `Protoboard ${board.board_id} removed from registry`
  });
}

// Brutal protoboard decision logic
function determineNextAction(board: Partial<Protoboard>): 'Stabilize' | 'Replace' | 'Integrate' | 'Kill it' {
  // If basic requirements aren't met, stabilize
  if (!board.voltage_stable || !board.current_draw_logged || !board.connection_map_documented) {
    return 'Stabilize';
  }

  // If signal integrity is terrible, kill it
  if (board.noise_level === 'High' && board.crosstalk_risk) {
    return 'Kill it';
  }

  // If Ursula can't see it, stabilize
  if (!board.detected || !board.address_stable) {
    return 'Stabilize';
  }

  // If noise is moderate but manageable, stabilize
  if (board.noise_level === 'Med' || board.crosstalk_risk) {
    return 'Stabilize';
  }

  // If everything looks good, integrate
  if (board.voltage_stable && board.current_draw_logged && 
      board.connection_map_documented && board.detected && 
      board.address_stable && board.noise_level === 'Low' && !board.crosstalk_risk) {
    return 'Integrate';
  }

  // Default to stabilize - most boards need work
  return 'Stabilize';
}

function getNextActionExplanation(action: string): string {
  switch (action) {
    case 'Stabilize':
      return 'Fix power, signal, or connection issues before proceeding.';
    case 'Replace':
      return 'Board has fundamental flaws - start over with new design.';
    case 'Integrate':
      return 'Board is ready for system integration and testing.';
    case 'Kill it':
      return 'Board is hopeless - retire it to avoid wasting more time.';
    default:
      return 'Evaluate board status and determine next steps.';
  }
}

// GET /api/ucmrs/protoboards/[id]/status - Quick status check
export async function GET_STATUS(request: NextRequest, { params }: { params: { id: string } }) {
  const board = protoboards.find(p => p.id === params.id);

  if (!board) {
    return NextResponse.json({ error: 'Protoboard not found' }, { status: 404 });
  }

  const status = {
    board_id: board.board_id,
    ready_for_integration: board.next_action === 'Integrate',
    critical_issues: [
      !board.voltage_stable && 'Power unstable',
      !board.detected && 'Not detected by Ursula',
      board.noise_level === 'High' && 'High noise levels',
      board.crosstalk_risk && 'Crosstalk risk detected'
    ].filter(Boolean),
    next_action: board.next_action,
    linked_components: board.linked_components.length
  };

  return NextResponse.json(status);
}
