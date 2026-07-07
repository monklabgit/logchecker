type MaterialItem = {
  quantity: string;
  description: string;
  note: string;
};

type ExtractionResult = {
  hospital: string;
  surgeon: string;
  patient: string;
  surgeryDate: string;
  surgeryTime: string;
  procedure: string;
  cmeItems: MaterialItem[];
  opmeItems: MaterialItem[];
  receivedCme: string;
  receivedOpme: string;
  observation: string;
  rawText: string;
};

type ExtractionRequest = {
  image?: unknown;
  file?: unknown;
  filename?: unknown;
  mimeType?: unknown;
};

const emptyResult: ExtractionResult = {
  hospital: '',
  surgeon: '',
  patient: '',
  surgeryDate: '',
  surgeryTime: '',
  procedure: '',
  cmeItems: [],
  opmeItems: [],
  receivedCme: '',
  receivedOpme: '',
  observation: '',
  rawText: '',
};

const itemSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    quantity: {
      type: 'string',
      description: 'Quantidade exatamente como aparece no documento, por exemplo 01 CX, 02 CX ou 01.',
    },
    description: {
      type: 'string',
      description: 'Descricao do material sem a quantidade e sem a observacao/kit.',
    },
    note: {
      type: 'string',
      description: 'Observacao ou kit do item, por exemplo KIT 49. Vazio se nao houver.',
    },
  },
  required: ['quantity', 'description', 'note'],
};

const extractionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    hospital: { type: 'string' },
    surgeon: { type: 'string' },
    patient: { type: 'string' },
    surgeryDate: { type: 'string' },
    surgeryTime: { type: 'string' },
    procedure: { type: 'string' },
    cmeItems: {
      type: 'array',
      items: itemSchema,
      description: 'Itens listados na secao CME. Deve ser array vazio se a secao estiver vazia ou ausente.',
    },
    opmeItems: {
      type: 'array',
      items: itemSchema,
      description: 'Itens listados na secao OPME. Deve ser array vazio se a secao estiver vazia ou ausente.',
    },
    receivedCme: {
      type: 'string',
      description: 'Nome/assinatura do funcionario CME, se estiver claramente legivel. Caso contrario vazio.',
    },
    receivedOpme: {
      type: 'string',
      description: 'Nome/assinatura do funcionario OPME, se estiver claramente legivel. Caso contrario vazio.',
    },
    observation: {
      type: 'string',
      description: 'Observacao geral relevante. Caso contrario vazio.',
    },
    rawText: {
      type: 'string',
      description: 'Transcricao curta do que foi possivel ler no documento.',
    },
  },
  required: [
    'hospital',
    'surgeon',
    'patient',
    'surgeryDate',
    'surgeryTime',
    'procedure',
    'cmeItems',
    'opmeItems',
    'receivedCme',
    'receivedOpme',
    'observation',
    'rawText',
  ],
};

const normalizeResult = (value: Partial<ExtractionResult>): ExtractionResult => ({
  ...emptyResult,
  ...value,
  cmeItems: Array.isArray(value.cmeItems) ? value.cmeItems : [],
  opmeItems: Array.isArray(value.opmeItems) ? value.opmeItems : [],
});

const sendJson = (res: any, status: number, payload: unknown) =>
  res.status(status).setHeader('Content-Type', 'application/json').send(JSON.stringify(payload));

const bodyFromRequest = (req: any): ExtractionRequest => {
  if (req.body && typeof req.body === 'object') return req.body as ExtractionRequest;
  if (typeof req.body === 'string') return JSON.parse(req.body) as ExtractionRequest;
  return {};
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  const apiKey = process.env.OPENAI_API_KEY_IMG_READ?.trim();
  if (!apiKey) {
    return sendJson(res, 500, { error: 'OPENAI_API_KEY_IMG_READ is not configured' });
  }

  let fileData: string;
  let filename: string;
  let mimeType: string;
  try {
    const body = bodyFromRequest(req);
    fileData =
      typeof body.file === 'string'
        ? body.file
        : typeof body.image === 'string'
          ? body.image
          : '';
    filename = typeof body.filename === 'string' && body.filename.trim() ? body.filename.trim() : 'documento';
    mimeType = typeof body.mimeType === 'string' ? body.mimeType : '';
  } catch {
    return sendJson(res, 400, { error: 'Invalid JSON body' });
  }

  if (!fileData.startsWith('data:')) {
    return sendJson(res, 400, { error: 'A data URL file is required' });
  }

  const isImage = fileData.startsWith('data:image/') || mimeType.startsWith('image/');
  const fileContent = isImage
    ? {
        type: 'input_image',
        image_url: fileData,
        detail: 'high',
      }
    : {
        type: 'input_file',
        filename,
        file_data: fileData,
      };

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4.1',
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text:
                'Extraia os dados deste arquivo brasileiro de solicitacao de cirurgia ou movimentacao de materiais da empresa Marja. ' +
                'Leia tabelas CME e OPME com cuidado. Nao invente informacoes. ' +
                'Se um campo ou assinatura nao estiver claramente legivel, retorne string vazia. ' +
                'Preserve nomes em maiusculas quando o documento estiver em maiusculas. ' +
                'Para cada material, separe quantidade, descricao e observacao/kit. ' +
                'Retorne somente o JSON estruturado solicitado.',
            },
            fileContent,
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'surgery_request_extraction',
          strict: true,
          schema: extractionSchema,
        },
      },
      max_output_tokens: 2200,
    }),
  });

  const openAiBody = await response.json().catch(() => null);

  if (!response.ok) {
    return sendJson(res, 502, {
      error: 'OpenAI request failed',
      detail: openAiBody?.error?.message || response.statusText,
    });
  }

  const outputText =
    typeof openAiBody?.output_text === 'string'
      ? openAiBody.output_text.trim()
      : openAiBody?.output
          ?.flatMap((item: { content?: Array<{ text?: string }> }) => item.content || [])
          ?.map((content: { text?: string }) => content.text || '')
          ?.join('')
          ?.trim();

  if (!outputText) {
    return sendJson(res, 502, { error: 'OpenAI returned no text' });
  }

  try {
    return sendJson(res, 200, { result: normalizeResult(JSON.parse(outputText)) });
  } catch {
    return sendJson(res, 502, { error: 'Could not parse OpenAI JSON output', raw: outputText });
  }
}
