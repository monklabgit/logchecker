import type { Config, Context } from '@netlify/functions';

declare const Netlify: {
  env: {
    get(name: string): string | undefined;
  };
};

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

const jsonHeaders = {
  'Content-Type': 'application/json',
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

type ExtractionRequest = {
  image?: unknown;
  file?: unknown;
  filename?: unknown;
  mimeType?: unknown;
};

export default async (req: Request, _context: Context) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: jsonHeaders });
  }

  const apiKey = (Netlify.env.get('OPENAI_API_KEY_IMG_READ') || process.env.OPENAI_API_KEY_IMG_READ)?.trim();
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'OPENAI_API_KEY_IMG_READ is not configured' }), { status: 500, headers: jsonHeaders });
  }

  let fileData: string;
  let filename: string;
  let mimeType: string;
  try {
    const body = (await req.json()) as ExtractionRequest;
    fileData =
      typeof body.file === 'string'
        ? body.file
        : typeof body.image === 'string'
          ? body.image
          : '';
    filename = typeof body.filename === 'string' && body.filename.trim() ? body.filename.trim() : 'documento';
    mimeType = typeof body.mimeType === 'string' ? body.mimeType : '';
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: jsonHeaders });
  }

  if (!fileData.startsWith('data:')) {
    return new Response(JSON.stringify({ error: 'A data URL file is required' }), { status: 400, headers: jsonHeaders });
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
      model: Netlify.env.get('OPENAI_MODEL') || process.env.OPENAI_MODEL || 'gpt-4.1',
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
    return new Response(
      JSON.stringify({
        error: 'OpenAI request failed',
        detail: openAiBody?.error?.message || response.statusText,
      }),
      { status: 502, headers: jsonHeaders }
    );
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
    return new Response(JSON.stringify({ error: 'OpenAI returned no text' }), { status: 502, headers: jsonHeaders });
  }

  try {
    return new Response(JSON.stringify({ result: normalizeResult(JSON.parse(outputText)) }), {
      status: 200,
      headers: jsonHeaders,
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Could not parse OpenAI JSON output', raw: outputText }), {
      status: 502,
      headers: jsonHeaders,
    });
  }
};

export const config: Config = {
  path: '/api/extract',
};
