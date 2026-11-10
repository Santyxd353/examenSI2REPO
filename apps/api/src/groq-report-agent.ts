import { ServiceUnavailableException } from '@nestjs/common';
import { reportTool } from './agent-report';
import type { AgentItem, AgentResponse } from './gemini-report-agent';

type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
type Message = {
  role: string;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

export class GroqReportAgent {
  private messages: Message[];
  private handledOutputs = 0;
  constructor(
    private key: string,
    private model: string,
    question: string,
  ) {
    this.messages = [{ role: 'user', content: question }];
  }
  async request(
    conversation: unknown[],
    round: number,
    signal: AbortSignal,
    instructions: string,
  ): Promise<AgentResponse> {
    const outputs = conversation.filter(
      (item): item is { type: string; call_id: string; output: string } =>
        typeof item === 'object' &&
        item !== null &&
        'type' in item &&
        item.type === 'function_call_output',
    );
    for (const output of outputs.slice(this.handledOutputs)) {
      this.messages.push({ role: 'tool', tool_call_id: output.call_id, content: output.output });
    }
    this.handledOutputs = outputs.length;
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this.key },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'system', content: instructions }, ...this.messages],
        tools: [
          {
            type: 'function',
            function: {
              name: reportTool.name,
              description: reportTool.description,
              parameters: reportTool.parameters,
            },
          },
        ],
        tool_choice:
          round === 0 ? { type: 'function', function: { name: reportTool.name } } : 'auto',
        parallel_tool_calls: false,
        max_completion_tokens: 3000,
        temperature: 0.1,
        ...(this.model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}),
      }),
    });
    if (!response.ok) {
      if (response.status === 429)
        throw new ServiceUnavailableException(
          'Groq alcanzó la cuota de consultas o tokens del plan actual. Espera a que se restablezca el límite antes de consultar de nuevo.',
        );
      if (response.status === 401 || response.status === 403)
        throw new ServiceUnavailableException(
          'Groq no autorizó la clave. Revisa el proyecto y sus permisos de modelos.',
        );
      throw new ServiceUnavailableException(
        'Groq no pudo completar el reporte (' +
          response.status +
          '). Reintenta o revisa el modelo configurado.',
      );
    }
    const body = (await response.json()) as { choices?: { message?: Message }[] };
    const message = body.choices?.[0]?.message;
    if (!message) throw new ServiceUnavailableException('Groq devolvió una respuesta vacía.');
    this.messages.push({
      role: 'assistant',
      content: message.content,
      ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
    });
    const output: AgentItem[] = (message.tool_calls || []).map((call) => ({
      type: 'function_call',
      call_id: call.id,
      name: call.function.name,
      arguments: call.function.arguments,
    }));
    if (message.content)
      output.push({ type: 'message', content: [{ type: 'output_text', text: message.content }] });
    return { output };
  }
}
