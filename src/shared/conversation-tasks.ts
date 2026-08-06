/** A durable, many-to-many link between a conversation and a Task Center task. */
export interface ConversationTaskLink {
  conversationId: string;
  taskId: string;
  createdAt: number;
}
