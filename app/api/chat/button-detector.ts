// button-detector.ts — Detecta opciones en texto de Claude → genera ButtonConfig[]
//
// RESPONSABILIDADES:
// 1. Parsear texto de Claude buscando patrones predecibles
// 2. Generar botones de OPCIÓN (envían texto al chat como si el cliente escribiera)
// 3. NO genera botones de ACCIÓN (esos se implementan en Fase 1B)
//
// PRINCIPIO: Si Claude puede predecir las respuestas posibles → BOTONES
//            Si no puede predecirlas → TEXTO LIBRE
//
// PRIORIDAD DE DETECCIÓN (primera que matchea gana):
// 1. Lista numerada (2+ items) → botones por opción + "Otra idea"
// 2. Pregunta de aprobación de texto → [Me gusta] [Cambios]
// 3. Oferta de imagen → [Sí, generar] [Sin imagen]
// 4. Aprobación de plan → [Aprobado] [Cambios]
// 5. Siguiente post → [Siguiente post] [Terminar]
// 6. Pregunta sí/no genérica → [Sí] [No]

// === TIPOS ===

export interface ButtonConfig {
  id: string;
  label: string;
  type: 'option' | 'action';
  style: 'primary' | 'secondary' | 'ghost';
  chatMessage?: string;    // Para type=option: texto que se envía al chat
  action?: string;         // Para type=action: endpoint (Fase 1B)
  params?: Record<string, unknown>;
}

// === FUNCIÓN PRINCIPAL ===

export function detectButtons(text: string): ButtonConfig[] | undefined {
  // PRIORIDAD 1: Lista numerada con 2+ items
  const numberedOptions = extractNumberedOptions(text);
  if (numberedOptions.length >= 2) {
    return buildOptionButtons(numberedOptions);
  }

  // PRIORIDAD 2: Pregunta de aprobación de texto
  if (/¿le gusta (este|el) texto|¿prefiere algún cambio|¿qué le parece el texto/i.test(text)) {
    return buildTextApprovalButtons();
  }

  // PRIORIDAD 3: Oferta de imagen
  if (/¿(le gustaría|quiere|desea)\s+(que\s+)?(genere|crear|generar|hacer)\s+(una\s+)?imagen/i.test(text)) {
    return buildImageOfferButtons();
  }

  // PRIORIDAD 4: Aprobación de plan
  if (/¿desea aprobar|¿aprueba (este|el) plan|¿le parece bien (este|el) plan/i.test(text)) {
    return buildPlanApprovalButtons();
  }

  // PRIORIDAD 5: Siguiente post
  if (/¿continuamos|¿seguimos|siguiente post|¿vamos con/i.test(text)) {
    return buildNextPostButtons();
  }

  // PRIORIDAD 6: Preguntas de cantidad (10 o 15 preguntas)
  if (/¿(vamos con|prefiere)\s+(las\s+)?\d+\s+(básicas|completas)|¿\d+\s+(básicas|completas)\s+o\s+\d+/i.test(text)) {
    return buildQuestionCountButtons();
  }

  // PRIORIDAD 7: Pregunta sí/no genérica
  if (/¿(desea|quiere|le gustaría)\s/i.test(text)) {
    return buildYesNoButtons();
  }

  // Sin botones detectados
  return undefined;
}

// === EXTRACTOR DE OPCIONES NUMERADAS ===

function extractNumberedOptions(text: string): Array<{ number: number; text: string }> {
  const options: Array<{ number: number; text: string }> = [];
  const lines = text.split('\n');

  for (const line of lines) {
    // Match: "1. Combo Romántico — descripción..." o "1) Texto..." o "1. **Texto** — desc"
    const match = line.match(/^\s*(\d+)[.)]\s+(?:\*\*)?([^—\n*]+)/);
    if (match) {
      const optText = match[2].trim().replace(/\*\*/g, '').replace(/\s*[-–—:]\s*$/, '');
      // Solo incluir si tiene al menos 2 caracteres (evitar basura)
      if (optText.length >= 2) {
        options.push({
          number: parseInt(match[1]),
          text: optText,
        });
      }
    }
  }

  return options;
}

// === BUILDERS DE BOTONES ===

function buildOptionButtons(options: Array<{ number: number; text: string }>): ButtonConfig[] {
  const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣'];

  const buttons: ButtonConfig[] = options.map((opt, i) => {
    // Truncar label si es muy largo (max 40 chars para UI)
    const truncated = opt.text.length > 40 ? opt.text.slice(0, 37) + '...' : opt.text;
    return {
      id: `option_${opt.number}`,
      label: `${emojis[i] || '▪️'} ${truncated}`,
      type: 'option' as const,
      style: 'secondary' as const,
      chatMessage: opt.text,
    };
  });

  // Siempre añadir "Otra idea" al final
  buttons.push({
    id: 'option_other',
    label: '✏️ Otra idea',
    type: 'option',
    style: 'ghost',
    chatMessage: '', // vacío = focus en input
  });

  return buttons;
}

function buildTextApprovalButtons(): ButtonConfig[] {
  return [
    { id: 'approve_text', label: '✅ Me gusta', type: 'option', style: 'primary', chatMessage: 'Me gusta el texto' },
    { id: 'change_text', label: '✏️ Pedir cambios', type: 'option', style: 'ghost', chatMessage: '' },
  ];
}

function buildImageOfferButtons(): ButtonConfig[] {
  return [
    { id: 'yes_image', label: '🎨 Sí, generar imagen', type: 'option', style: 'primary', chatMessage: 'Sí, genera una imagen' },
    { id: 'no_image', label: '⭕ Sin imagen', type: 'option', style: 'ghost', chatMessage: 'Sin imagen, continúa' },
  ];
}

function buildPlanApprovalButtons(): ButtonConfig[] {
  return [
    { id: 'approve_plan', label: '✅ Aprobado', type: 'option', style: 'primary', chatMessage: 'Aprobado' },
    { id: 'change_plan', label: '✏️ Cambios', type: 'option', style: 'ghost', chatMessage: '' },
  ];
}

function buildNextPostButtons(): ButtonConfig[] {
  return [
    { id: 'next_post', label: '▶️ Siguiente post', type: 'option', style: 'primary', chatMessage: 'Continuemos con el siguiente post' },
    { id: 'pause', label: '⏸️ Terminar por hoy', type: 'option', style: 'ghost', chatMessage: 'Pausar el plan por ahora' },
  ];
}

function buildQuestionCountButtons(): ButtonConfig[] {
  return [
    { id: 'questions_10', label: '⚡ 10 básicas', type: 'option', style: 'primary', chatMessage: '10 básicas' },
    { id: 'questions_15', label: '📋 15 completas', type: 'option', style: 'secondary', chatMessage: '15 completas' },
  ];
}

function buildYesNoButtons(): ButtonConfig[] {
  return [
    { id: 'yes', label: '✅ Sí', type: 'option', style: 'primary', chatMessage: 'Sí' },
    { id: 'no', label: '❌ No', type: 'option', style: 'secondary', chatMessage: 'No' },
  ];
}
