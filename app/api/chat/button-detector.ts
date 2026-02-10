// button-detector.ts — Detecta opciones en texto de Claude → genera ButtonConfig[]
//
// RESPONSABILIDADES:
// 1. Parsear texto de Claude buscando patrones predecibles
// 2. Generar botones de OPCIÓN (envían texto al chat como si el cliente escribiera)
// 3. Usar guardianState para detectar describe_image → botones de generación
//
// PRINCIPIO: Si Claude puede predecir las respuestas posibles → BOTONES
//            Si no puede predecirlas → TEXTO LIBRE
//            El input de texto SIEMPRE está disponible — botones complementan, no reemplazan.
//
// PRIORIDADES DE DETECCIÓN (primera que matchea gana):
//  1. Imagen descrita (via guardianState.describeImageWasCalled) → [Generar imagen] [Sin imagen]
//  2. Aprobación de plan → [Aprobado] [Cambios]
//  3. Aprobación de texto → [Me gusta] [Cambios]
//  4. Publicar ahora vs programar → [Ahora] [Según el plan]
//  5. Oferta de imagen → [Sí, generar] [Sin imagen]
//  6. Lista numerada (2+ items) → botones por opción + "Otra idea"
//  7. Preguntas de cantidad (10/15) → [10 básicas] [15 completas]
//  8. Siguiente post → [Siguiente post] [Terminar]
//  9. Conectar plataforma → [Sí, conectar] [Solo Facebook]
// --- PREGUNTAS DE ENTREVISTA (detección por contenido) ---
// 10. ¿Cómo llegan los clientes? → opciones predefinidas
// 11. ¿Qué quiere lograr? → opciones predefinidas
// 12. ¿Qué valoran sus clientes? → opciones predefinidas
// 13. ¿Ha hecho marketing antes? → opciones predefinidas
// 14. ¿Tiene oferta/promoción? → [No] [Sí]

// === TIPOS ===

export interface ButtonConfig {
  id: string;
  label: string;
  type: 'option' | 'action';
  style: 'primary' | 'secondary' | 'ghost';
  chatMessage?: string;    // Para type=option: texto que se envía al chat
  action?: string;         // Para type=action: endpoint
  params?: Record<string, unknown>;
}

// Estado mínimo que necesitamos del guardian para detección
export interface DetectorState {
  describeImageWasCalled: boolean;
  hasImageSpec: boolean;
}

// === FUNCIÓN PRINCIPAL ===

export function detectButtons(text: string, state?: DetectorState): ButtonConfig[] | undefined {
  // Usar solo las últimas ~1500 chars para detección de preguntas
  const tail = text.length > 1500 ? text.slice(-1500) : text;

  // ══════════════════════════════════════════════════
  // PRIORIDAD 1: Imagen descrita (via guardianState — describe_image fue llamada)
  // → Botones de ACCIÓN: cliente ejecuta generación de imagen
  // ══════════════════════════════════════════════════
  if (state?.describeImageWasCalled && state.hasImageSpec) {
    return buildImageGenerateButtons();
  }

  // ══════════════════════════════════════════════════
  // PRIORIDAD 2-5: Preguntas específicas del flujo de publicación
  // ══════════════════════════════════════════════════

  // 2. Aprobación de plan (ANTES de lista numerada — planes incluyen posts numerados)
  if (/¿desea aprobar|¿aprueba (este|el) plan|¿le parece bien (este|el) plan|aprobar este plan/i.test(tail)) {
    return buildPlanApprovalButtons();
  }

  // 3. Aprobación de texto
  if (/¿le gusta (este|el) texto|¿prefiere algún cambio|¿qué le parece el texto|cambio al texto/i.test(tail)) {
    return buildTextApprovalButtons();
  }

  // 4. Publicar ahora vs programar
  if (/¿lo publico ahora|publico ahora o.*(programo|agendo)|publicar(lo)? ahora o|ahora mismo o.*(program|agend)|ahora o lo program/i.test(tail)) {
    return buildPublishTimingButtons();
  }

  // 5. Oferta de imagen (¿quiere que genere imagen?)
  if (/¿(le gustaría|quiere|desea)\s+(que\s+)?(genere|crear|generar|hacer|prepare|diseñe)\s+(una\s+)?imagen|generar una imagen.*\?|imagen.*para acompañar|imagen.*profesional|preparar.*imagen/i.test(tail)) {
    return buildImageOfferButtons();
  }

  // ══════════════════════════════════════════════════
  // PRIORIDAD 6: Lista numerada (estrategias, opciones de Claude)
  // ══════════════════════════════════════════════════
  const numberedOptions = extractNumberedOptions(tail);
  if (numberedOptions.length >= 2) {
    return buildOptionButtons(numberedOptions);
  }

  // ══════════════════════════════════════════════════
  // PRIORIDAD 7-8: Flujo conversacional
  // ══════════════════════════════════════════════════

  // 7. Preguntas de cantidad (10 o 15 preguntas)
  if (/\d+\s*(preguntas?\s+)?(básicas?|completas?).*(\?|o\s+\d+)|¿(vamos con|prefiere)\s+(las\s+)?\d+/i.test(tail)) {
    return buildQuestionCountButtons();
  }

  // 8. Siguiente post
  if (/¿continuamos|¿seguimos con|siguiente post|¿vamos con (el|la) siguiente/i.test(tail)) {
    return buildNextPostButtons();
  }

  // ══════════════════════════════════════════════════
  // PRIORIDAD 9: Conectar plataforma adicional
  // ══════════════════════════════════════════════════
  if (/¿(le gustaría|quiere|desea)\s+(también\s+)?(conectar|añadir|agregar)\s+(también\s+)?(instagram|twitter|tiktok|linkedin)/i.test(tail)) {
    const platform = tail.match(/instagram|twitter|tiktok|linkedin/i)?.[0] || 'Instagram';
    return buildConnectPlatformButtons(platform);
  }

  if (/solo con facebook|empezar (solo\s+)?con facebook|prefiere.*solo.*facebook/i.test(tail)) {
    return buildConnectPlatformButtons('Instagram');
  }

  // ══════════════════════════════════════════════════
  // PRIORIDAD 10-14: PREGUNTAS DE ENTREVISTA
  // Solo matchean PREGUNTAS DIRECTAS (con signos de interrogación).
  // NO deben matchear menciones casuales en resúmenes o contexto.
  // ══════════════════════════════════════════════════

  // 10. ¿Cómo le llegan los clientes?
  if (/¿cómo le llegan los clientes|¿cómo llegan.*clientes\?/i.test(tail)) {
    return buildClientSourceButtons();
  }

  // 11. ¿Qué quiere lograr?
  if (/¿qué (quiere|desea|le gustaría) lograr|¿qué.*quiere.*marketing\?/i.test(tail)) {
    return buildGoalButtons();
  }

  // 12. ¿Qué valoran sus clientes?
  if (/¿qué.*clientes.*valoran|¿qué.*más valoran/i.test(tail)) {
    return buildValueButtons();
  }

  // 13. ¿Ha hecho marketing antes?
  // ESTRICTO: solo matchea la pregunta directa con ¿, NO menciones como "primera vez" en resúmenes
  if (/¿ha hecho marketing|¿ha (publicado|hecho).*redes\?|marketing o publicidad antes\?/i.test(tail)) {
    return buildMarketingHistoryButtons();
  }

  // 14. ¿Tiene oferta o promoción?
  if (/¿tiene.*(oferta|promoción)\??/i.test(tail)) {
    return buildHasPromoButtons();
  }

  // ══════════════════════════════════════════════════
  // NO MATCH — sin botones
  // ══════════════════════════════════════════════════
  return undefined;
}

// === EXTRACTOR DE OPCIONES NUMERADAS ===

function extractNumberedOptions(text: string): Array<{ number: number; text: string }> {
  const options: Array<{ number: number; text: string }> = [];
  const seen = new Set<string>();
  const lines = text.split('\n');

  for (const line of lines) {
    const match = line.match(/^\s*(\d+)[.)]\s+(?:\*\*)?([^—\n*]+)/);
    if (match) {
      const optText = match[2].trim().replace(/\*\*/g, '').replace(/\s*[-–—:]\s*$/, '');
      if (optText.length >= 2 && !seen.has(optText.toLowerCase())) {
        seen.add(optText.toLowerCase());
        options.push({
          number: parseInt(match[1]),
          text: optText,
        });
      }
    }
  }

  return options;
}

// ═══════════════════════════════════════════════════════
// BUILDERS DE BOTONES — FLUJO DE PUBLICACIÓN
// ═══════════════════════════════════════════════════════

function buildOptionButtons(options: Array<{ number: number; text: string }>): ButtonConfig[] {
  const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣'];

  const buttons: ButtonConfig[] = options.map((opt, i) => {
    const truncated = opt.text.length > 40 ? opt.text.slice(0, 37) + '...' : opt.text;
    return {
      id: `option_${opt.number}`,
      label: `${emojis[i] || '▪️'} ${truncated}`,
      type: 'option' as const,
      style: 'secondary' as const,
      chatMessage: opt.text,
    };
  });

  buttons.push({
    id: 'option_other',
    label: '✏️ Otra idea',
    type: 'option',
    style: 'ghost',
    chatMessage: '',
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

function buildPublishTimingButtons(): ButtonConfig[] {
  return [
    { id: 'publish_now', label: '🚀 Publicar ahora', type: 'option', style: 'primary', chatMessage: 'Publícalo ahora' },
    { id: 'publish_scheduled', label: '📅 Según el plan', type: 'option', style: 'secondary', chatMessage: 'Prográmalo según el plan' },
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

// ═══════════════════════════════════════════════════════
// BUILDERS DE BOTONES — CONECTAR PLATAFORMA
// ═══════════════════════════════════════════════════════

function buildConnectPlatformButtons(platform: string): ButtonConfig[] {
  const capitalized = platform.charAt(0).toUpperCase() + platform.slice(1).toLowerCase();
  return [
    { id: 'connect_yes', label: `📱 Sí, conectar ${capitalized}`, type: 'option', style: 'primary', chatMessage: `Sí, quiero conectar ${capitalized}` },
    { id: 'connect_no', label: '👍 Solo Facebook', type: 'option', style: 'secondary', chatMessage: 'Solo Facebook por ahora' },
  ];
}

// ═══════════════════════════════════════════════════════
// BUILDERS DE BOTONES — PREGUNTAS DE ENTREVISTA
// ═══════════════════════════════════════════════════════

function buildClientSourceButtons(): ButtonConfig[] {
  return [
    { id: 'source_front', label: '🚶 Pasan por el frente', type: 'option', style: 'secondary', chatMessage: 'Pasan por el frente del local' },
    { id: 'source_referral', label: '🗣️ Referidos', type: 'option', style: 'secondary', chatMessage: 'Por recomendación de otros clientes' },
    { id: 'source_social', label: '📱 Redes sociales', type: 'option', style: 'secondary', chatMessage: 'Por redes sociales' },
    { id: 'source_other', label: '✏️ Otro', type: 'option', style: 'ghost', chatMessage: '' },
  ];
}

function buildGoalButtons(): ButtonConfig[] {
  return [
    { id: 'goal_clients', label: '👥 Más clientes', type: 'option', style: 'secondary', chatMessage: 'Quiero más clientes nuevos' },
    { id: 'goal_sales', label: '💰 Más ventas', type: 'option', style: 'secondary', chatMessage: 'Quiero aumentar las ventas' },
    { id: 'goal_awareness', label: '📢 Darme a conocer', type: 'option', style: 'secondary', chatMessage: 'Quiero que más gente conozca mi negocio' },
    { id: 'goal_other', label: '✏️ Otro', type: 'option', style: 'ghost', chatMessage: '' },
  ];
}

function buildValueButtons(): ButtonConfig[] {
  return [
    { id: 'value_quality', label: '⭐ Calidad', type: 'option', style: 'secondary', chatMessage: 'La calidad de los productos' },
    { id: 'value_price', label: '💲 Precio', type: 'option', style: 'secondary', chatMessage: 'Los buenos precios' },
    { id: 'value_service', label: '🤝 Servicio', type: 'option', style: 'secondary', chatMessage: 'El buen servicio al cliente' },
    { id: 'value_other', label: '✏️ Otro', type: 'option', style: 'ghost', chatMessage: '' },
  ];
}

function buildMarketingHistoryButtons(): ButtonConfig[] {
  return [
    { id: 'marketing_no', label: '🆕 No, primera vez', type: 'option', style: 'secondary', chatMessage: 'No, nunca he hecho marketing' },
    { id: 'marketing_social', label: '📱 Sí, redes sociales', type: 'option', style: 'secondary', chatMessage: 'Sí, he publicado en redes sociales' },
    { id: 'marketing_other', label: '📋 Sí, otro tipo', type: 'option', style: 'secondary', chatMessage: 'Sí, he hecho otro tipo de publicidad' },
  ];
}

function buildHasPromoButtons(): ButtonConfig[] {
  return [
    { id: 'promo_no', label: '❌ No tengo', type: 'option', style: 'secondary', chatMessage: 'No tengo ninguna promoción activa' },
    { id: 'promo_yes', label: '✅ Sí tengo', type: 'option', style: 'secondary', chatMessage: 'Sí, tengo una promoción' },
    { id: 'promo_idea', label: '💡 Tengo una idea', type: 'option', style: 'secondary', chatMessage: 'No tengo activa pero tengo una idea' },
  ];
}

// ═══════════════════════════════════════════════════════
// BUILDERS DE BOTONES — ACCIÓN (ejecutan código directo)
// ═══════════════════════════════════════════════════════

function buildImageGenerateButtons(): ButtonConfig[] {
  return [
    {
      id: 'generate_image',
      label: '🎨 Generar imagen',
      type: 'action',
      style: 'primary',
      action: 'generate_image',
    },
    {
      id: 'skip_image',
      label: '⭕ Sin imagen, publicar',
      type: 'action',
      style: 'ghost',
      action: 'publish_no_image',
    },
  ];
}
