import { ReportAiProvider } from '../src/reporting/ai-provider';

const previous = { ...process.env };
beforeEach(() => {
  process.env.REPORT_AI_PROVIDER = 'groq';
  process.env.GROQ_API_KEY = 'qa-key';
  process.env.GROQ_REPORTS_MODEL = 'openai/gpt-oss-20b';
});
afterEach(() => {
  jest.restoreAllMocks();
  for (const key of ['REPORT_AI_PROVIDER', 'GROQ_API_KEY', 'GROQ_REPORTS_MODEL']) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
});

function mockContent(content: string) {
  return jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content } }] })));
}

test('GPT-OSS requests strict report shapes and translates an absent comparison', async () => {
  const fetch = mockContent(
    JSON.stringify({
      action: 'PROPOSE',
      explanation: 'Ventas por categoría.',
      specification: { title: 'Ventas', comparison: null, order: [], limit: 12, filters: [] },
    }),
  );
  const result = await new ReportAiProvider().interpret('Ventas por categoría', {});
  const request = JSON.parse(String(fetch.mock.calls[0][1]?.body));
  expect(request.response_format).toMatchObject({
    type: 'json_schema',
    json_schema: { strict: true },
  });
  const schema = request.response_format.json_schema.schema;
  const specification = schema.properties.specification.anyOf.find((s: any) => s.type === 'object');
  expect(specification.properties.order.type).toBe('array');
  expect(specification.properties.limit.type).toBe('integer');
  expect(specification.properties.widgets).toMatchObject({ type: 'array', maxItems: 4 });
  expect(specification.properties.widgets.items.required).toEqual([
    'id',
    'chart',
    'dimension',
    'metric',
  ]);
  expect(specification.additionalProperties).toBe(false);
  expect(result).toMatchObject({ specification: { order: [], limit: 12, filters: [] } });
  expect((result as any).specification).not.toHaveProperty('comparison');
});

test('other Groq models retain JSON mode and unknown fields remain for domain rejection', async () => {
  process.env.GROQ_REPORTS_MODEL = 'llama-3.3-70b-versatile';
  const fetch = mockContent(
    JSON.stringify({ action: 'PROPOSE', specification: { sql: 'SELECT 1' } }),
  );
  const result = await new ReportAiProvider().interpret('Ventas', {});
  expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).response_format).toEqual({
    type: 'json_object',
  });
  expect(result).toMatchObject({ specification: { sql: 'SELECT 1' } });
});

test('unreadable provider output stays an invalid proposal', async () => {
  mockContent('not JSON');
  await expect(new ReportAiProvider().interpret('Ventas', {})).rejects.toMatchObject({
    response: { code: 'REPORT_AI_INVALID_PROPOSAL' },
  });
});
