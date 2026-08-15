export interface PhotoForgeState {
  image?: string;
  tool?: string;
  selection?: string;
  lastAction?: string;
}

export function buildPhotoForgeContext(state: PhotoForgeState): string {
  const lines = ['[Photo Forge Context]', `Workspace: Photo Forge`];
  if (state.image) lines.push(`Image: ${state.image}`);
  if (state.tool) lines.push(`Tool: ${state.tool}`);
  if (state.selection) lines.push(`Selection: ${state.selection}`);
  if (state.lastAction) lines.push(`Last action: ${state.lastAction}`);
  lines.push('[/Photo Forge Context]');
  return lines.join('\n');
}

export function buildPhotoForgeMessage(state: PhotoForgeState, question: string): string {
  const context = buildPhotoForgeContext(state);
  return `${context}\n\nUser question: ${question}`;
}
