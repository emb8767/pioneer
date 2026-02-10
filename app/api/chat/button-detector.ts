// button-detector.ts — Detecta opciones en texto de Claude → genera ButtonConfig[]
//
// RESPONSABILIDADES:
// 1. Parsear texto de Claude buscando patrones predecibles
// 2. Generar botones de OPCIÓN (envían texto al chat como si el cliente escribiera)
// 3. Usar guardianState para detectar imagen generada → botones de aprobación
//
// PRINCIPIO: Si Claude puede predecir las respuestas posibles → BOTONES
//            Si no puede predecirlas → TEXTO LIBRE
//            El input de texto SIEMPRE está disponible — botones complementan, no reemplazan.
//
// PRIORIDADES DE DETECCIÓN (primera que matchea gana):
//  1. Imagen generada (via guardianState) → [Me gusta] [Otra imagen] [Sin imagen]
//  2. Aprobación de plan → [Aprobado] [Cambios]
//  3. Aprobación de texto → [Me gusta] [Cambios]
//  4. Aprobación de imagen (via texto, fallback) → [Me gusta] [Otra] [Sin imagen]
//  5. Publicar ahora vs programar → [Ahora] [Según el plan]
//  6. Oferta de imagen → [Sí, generar] [Sin imagen]
//  7. Lista numerada (2+ items) → botones por opción + "Otra idea"
//  8. Preguntas de cantidad (10/15) → [10 básicas] [15 completas]
//  9. Siguiente post → [Siguiente post] [Terminar]
// 10. Conectar plataforma → [Sí, conectar] [Solo Facebook]
// --- PREGUNTAS DE ENTREVISTA (detección por contenido) ---
// 11. ¿Cómo llegan los clientes? → opciones predefinidas
// 12. ¿Qué quiere lograr? → opciones predefinidas
// 13. ¿Qué valoran sus clientes? → opciones predefinidas
// 14. ¿Ha hecho marketing antes? → opciones predefinidas
// 15. ¿Tiene oferta/promoción? → [No] [Sí]

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

// Estado mínimo que necesitamos del guardian para detección de imagen
export interface DetectorState {
  generateImageWasCalled: boolean;
  lastGeneratedImageUrls: string[];
}

// === FUNCIÓN PRINCIPAL ===

export function detectButtons(text: string, state?: DetectorState): ButtonConfig[] | undefined {
  // Usar solo las últimas ~1500 chars para detección de preguntas
  // (evita falsos positivos del contexto anterior en mensajes largos)
  const tail = text.length > 1500 ? text.slice(-1500) : text;

  // ══════════════════════════════════════════════════
  // PRIORIDAD 1: Imagen generada (via guardianState — más confiable que regex)
  // → Botones de ACCIÓN: publican directo sin pasar por Claude
  // ══════════════════════════════════════════════════
  if (state?.generateImageWasCalled && state.lastGeneratedImageUrls.length > 0) {
    return buildImageActionButtons();
  }

  // ══════════════════════════════════════════════════
  // PRIORIDAD 2-6: Preguntas específicas del flujo de publicación
  // ══════════════════════════════════════════════════

  // 2. Aprobación de plan (ANTES de lista numerada — planes incluyen posts numerados)
  if (/¿desea aprobar|¿aprueba (este|el) plan|¿le parece bien (este|el) plan|aprobar este plan/i.test(tail)) {
    return buildPlanApprovalButtons();
  }

  // 3. Aprobación de texto
  if (/¿le gusta (este|el) texto|¿prefiere algún cambio|¿qué le parece el texto|cambio al texto/i.test(tail)) {
    return buildTextApprovalButtons();
  }

  // 4. Aprobación de imagen (fallback por texto si guardianState no está disponible)
  if (/¿le gusta (esta|la) imagen|genere (otra|una diferente)|estilo diferente|¿qué le parece la imagen/i.test(tail)) {
    return buildImageApprovalButtons();
  }

  // 5. Publicar ahora vs programar (temporal — Fase 1B eliminará esta pregunta)
  if (/¿lo publico ahora|publico ahora o.*(programo|agendo)|publicar(lo)? ahora o|ahora mismo o.*(program|agend)|ahora o lo program/i.test(tail)) {
    return buildPublishTimingButtons();
  }

  // 6. Oferta de imagen (¿quiere que genere imagen?)
  if (/¿(le gustaría|quiere|desea)\s+(que\s+)?(genere|crear|generar|hacer)\s+(una\s+)?imagen|generar una imagen.*\?|imagen.*para acompañar|imagen.*profesional/i.test(tail)) {
    return buildImageOfferButtons();
  }

  // ══════════════════════════════════════════════════
  // PRIORIDAD 7: Lista numerada (estrategias, opciones de Claude)
  // ══════════════════════════════════════════════════
  const numberedOptions = extractNumberedOptions(tail);
  if (numberedOptions.length >= 2) {
    return buildOptionButtons(numberedOptions);
  }

  // ══════════════════════════════════════════════════
  // PRIORIDAD 8-9: Flujo conversacional
  // ══════════════════════════════════════════════════

  // 8. Preguntas de cantidad (10 o 15 preguntas)
  if (/\d+\s*(preguntas?\s+)?(básicas?|completas?).*(\?|o\s+\d+)|¿(vamos con|prefiere)\s+(las\s+)?\d+/i.test(tail)) {
    return buildQuestionCountButtons();
  }

  // 9. Siguiente post
  if (/¿continuamos|¿seguimos con|siguiente post|¿vamos con (el|la) siguiente/i.test(tail)) {
    return buildNextPostButtons();
  }

  // ══════════════════════════════════════════════════
  // PRIORIDAD 10: Conectar plataforma adicional
  // ══════════════════════════════════════════════════
  if (/¿(le gustaría|quiere|desea)\s+(también\s+)?(conectar|añadir|agregar)\s+(también\s+)?(instagram|twitter|tiktok|linkedin)/i.test(tail)) {
    const platform = tail.match(/instagram|twitter|tiktok|linkedin/i)?.[0] || 'Instagram';
    return buildConnectPlatformButtons(platform);
  }

  // Solo con Facebook mencionado
  if (/solo con facebook|empezar (solo\s+)?con facebook|prefiere.*solo.*facebook/i.test(tail)) {
    return buildConnectPlatformButtons('Instagram');
  }

  // ══════════════════════════════════════════════════
  // PRIORIDAD 11-15: PREGUNTAS DE ENTREVISTA (detección por contenido)
  // Estas matchean las preguntas que Pioneer hace durante la entrevista
  // y ofrecen opciones predefinidas para las que son "mixtas" (tienen
  // respuestas predecibles pero también permiten texto libre).
  // ══════════════════════════════════════════════════

  // 11. ¿Cómo le llegan los clientes?
  if (/¿cómo le llegan los clientes|¿cómo llegan.*clientes|pasan por el frente.*referid|referid.*redes sociales/i.test(tail)) {
    return buildClientSourceButtons();
  }

  // 12. ¿Qué quiere lograr?
  if (/¿qué (quiere|desea|le gustaría) lograr|¿qué.*quiere.*marketing|más clientes.*más ventas.*darse a conocer/i.test(tail)) {
    return buildGoalButtons();
  }

  // 13. ¿Qué valoran sus clientes?
  if (/¿qué.*clientes.*valoran|¿qué.*más valoran|calidad.*precio.*servicio.*rapid/i.test(tail)) {
    return buildValueButtons();
  }

  // 14. ¿Ha hecho marketing antes?
  if (/¿ha hecho marketing|¿ha (publicado|hecho).*redes|marketing o publicidad antes|primera vez/i.test(tail)) {
    return buildMarketingHistoryButtons();
  }

  // 15. ¿Tiene oferta o promoción?
  if (/¿tiene.*(oferta|promoción)|oferta o promoción activa|promoción.*activa/i.test(tail)) {
    return buildHasPromoButtons();
  }

  // ══════════════════════════════════════════════════
  // NO MATCH — sin botones
  // ══════════════════════════════════════════════════
  // NOTA: Eliminamos el Sí/No genérico porque causaba falsos positivos
  // en preguntas abiertas de la entrevista. Si se necesita Sí/No,
  // se agrega como detector específico arriba.

  return undefined;
}

// === EXTRACTOR DE OPCIONES NUMERADAS ===

function extractNumberedOptions(text: string): Array<{ number: number; text: string }> {
  const options: Array<{ number: number; text: string }> = [];
  const seen = new Set<string>(); // Deduplicar por texto
  const lines = text.split('\n');

  for (const line of lines) {
    // Match: "1. Combo Romántico — descripción..." o "1) Texto..." o "1. **Texto** — desc"
    const match = line.match(/^\s*(\d+)[.)]\s+(?:\*\*)?([^—\n*]+)/);
    if (match) {
      const optText = match[2].trim().replace(/\*\*/g, '').replace(/\s*[-–—:]\s*$/, '');
      // Solo incluir si tiene al menos 2 caracteres y no es duplicado
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

function buildImageApprovalButtons(): ButtonConfig[] {
  return [
    { id: 'approve_image', label: '👍 Me gusta', type: 'option', style: 'primary', chatMessage: 'Me gusta la imagen' },
    { id: 'regenerate', label: '🔄 Otra imagen', type: 'option', style: 'secondary', chatMessage: 'Genera otra imagen diferente' },
    { id: 'skip_image', label: '⭕ Sin imagen', type: 'option', style: 'ghost', chatMessage: 'Sin imagen, continúa' },
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
// BUILDERS DE BOTONES — ACCIÓN (Fase 1B — ejecutan código directo)
// ═══════════════════════════════════════════════════════

function buildImageActionButtons(): ButtonConfig[] {
  return [
    {
      id: 'approve_image',
      label: '👍 Aprobar y programar',
      type: 'action',
      style: 'primary',
      action: 'approve_and_publish',
    },
    {
      id: 'regenerate',
      label: '🔄 Otra imagen',
      type: 'action',
      style: 'secondary',
      action: 'regenerate_image',
    },
    {
      id: 'skip_image',
      label: '⭕ Sin imagen',
      type: 'action',
      style: 'ghost',
      action: 'publish_no_image',
    },
  ];
}
