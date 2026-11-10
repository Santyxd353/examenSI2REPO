import { ServiceUnavailableException } from '@nestjs/common';
import { reportTool } from './agent-report';

export type AgentItem = {
  type?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  content?: { type?: string; text?: string }[];
};
export type AgentResponse = { output?: AgentItem[]; output_text?: string };
type Part = {
  text?: string;
  functionCall?: { id?: string; name: string; args?: unknown };
  [key: string]: unknown;
};
type Content = { role: string; parts: Part[] };

/** Conserva el contenido nativo y las firmas de Gemini entre llamadas a herramientas. */
export class GeminiReportAgent {
  private contents: Content[];
  private handledOutputs = 0;
  private callId: string | undefined;
  constructor(
    private key: string,
    private model: string,
    question: string,
  ) {
    this.contents = [{ role: 'user', parts: [{ text: question }] }];
  }
  async request(
    conversation: unknown[],
    round: number,
    signal: AbortSignal,
    instructions: string,
  ): Promise<AgentResponse> {
    const outputs = conversation.filter(
      (item): item is { type: string; output: string } =>
        typeof item === 'object' &&
        item !== null &&
        'type' in item &&
        item.type === 'function_call_output',
    );
    for (const output of outputs.slice(this.handledOutputs)) {
      this.contents.push({
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'generar_reporte',
              ...(this.callId ? { id: this.callId } : {}),
              response: JSON.parse(output.output),
            },
          },
        ],
      });
    }
    this.handledOutputs = outputs.length;
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' +
        encodeURIComponent(this.model) +
        ':generateContent',
      {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: instructions }] },
          contents: this.contents,
          tools: [
            {
              functionDeclarations: [
                {
                  name: reportTool.name,
                  description: reportTool.description,
                  parametersJsonSchema: reportTool.parameters,
                },
              ],
            },
          ],
          toolConfig: {
            functionCallingConfig: {
              mode: round === 0 ? 'ANY' : 'AUTO',
              ...(round === 0 ? { allowedFunctionNames: ['generar_reporte'] } : {}),
            },
          },
          generationConfig: {
            maxOutputTokens: 3000,
            temperature: 0.1,
            ...(this.model === 'gemini-2.5-flash' ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          },
        }),
      },
    );
    if (!response.ok) {
      const failure = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      if (response.status === 403 && failure.error?.message?.includes('free tier is not available'))
        throw new ServiceUnavailableException(
          'Google no habilitó el nivel gratuito de Gemini para este proyecto. Revisa el proyecto y su plan en Google AI Studio; la generación está bloqueada por el proveedor.',
        );
      if (response.status === 429)
        throw new ServiceUnavailableException(
          'Gemini alcanzó la cuota disponible del proyecto. Revisa los límites en Google AI Studio y reintenta cuando se restablezcan.',
        );
      if (response.status === 400 || response.status === 403)
        throw new ServiceUnavailableException(
          'Gemini no autorizó la consulta. Revisa la clave, el proyecto y el modelo en Google AI Studio.',
        );
      throw new ServiceUnavailableException(
        'Gemini no pudo generar el reporte (' + response.status + '). Reintenta la consulta.',
      );
    }
    const body = (await response.json()) as { candidates?: { content?: Content }[] };
    const content = body.candidates?.[0]?.content;
    if (!content?.parts?.length)
      throw new ServiceUnavailableException(
        'Gemini no devolvió una respuesta válida para el reporte.',
      );
    this.contents.push(content);
    const output: AgentItem[] = [];
    for (const part of content.parts) {
      if (part.functionCall) {
        this.callId = part.functionCall.id;
        output.push({
          type: 'function_call',
          name: part.functionCall.name,
          call_id: part.functionCall.id || 'gemini-' + round,
          arguments: JSON.stringify(part.functionCall.args || {}),
        });
      } else if (part.text && !part.thought) {
        output.push({ type: 'message', content: [{ type: 'output_text', text: part.text }] });
      }
    }
    return { output };
  }
}
