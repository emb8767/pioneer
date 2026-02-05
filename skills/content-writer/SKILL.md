# Content Writer Skill

## Descripción

Este skill permite a Pioneer generar contenido de texto para publicaciones en redes sociales. Toma la información del negocio, el objetivo de la campaña y el tipo de post, y genera texto optimizado para cada plataforma.

## Archivos de este skill

| Archivo | Propósito |
|---------|-----------|
| `SKILL.md` | Este archivo - lógica del generador de contenido |
| `prompts.md` | Prompts base para cada tipo de contenido |

## Cómo funciona

```
Plan aprobado por el cliente
        ↓
Identificar tipo de post (del plan)
        ↓
Seleccionar prompt base según tipo
        ↓
Personalizar con datos del negocio
        ↓
Generar contenido con Claude API
        ↓
Adaptar longitud según plataforma
        ↓
Agregar hashtags si aplica
        ↓
Devolver contenido listo para publicar
```

## Tipos de contenido soportados

### 1. Post de oferta/promoción
- **Uso:** Ventas, descuentos, liquidaciones
- **Tono:** Urgente pero profesional
- **Elementos:** Precio/descuento, CTA claro, fecha límite si hay
- **Largo:** 100-200 palabras

### 2. Post educativo/tips
- **Uso:** Posicionar como experto, dar valor
- **Tono:** Informativo, útil
- **Elementos:** Tip práctico, relación con el negocio
- **Largo:** 100-250 palabras

### 3. Post de testimonio/social proof
- **Uso:** Generar confianza
- **Tono:** Auténtico, cercano
- **Elementos:** Historia del cliente, resultado concreto
- **Largo:** 80-150 palabras

### 4. Post de "detrás de escenas"
- **Uso:** Humanizar la marca
- **Tono:** Casual, personal
- **Elementos:** Proceso, equipo, día a día
- **Largo:** 80-150 palabras

### 5. Post de urgencia/escasez
- **Uso:** Impulsar acción inmediata
- **Tono:** Urgente, directo
- **Elementos:** Cantidad limitada, tiempo limitado
- **Largo:** 50-100 palabras

### 6. Post de CTA (llamada a acción)
- **Uso:** Conversión directa
- **Tono:** Directo, persuasivo
- **Elementos:** Beneficio claro, instrucción específica
- **Largo:** 50-120 palabras

### 7. Post de branding/presentación
- **Uso:** Dar a conocer el negocio
- **Tono:** Profesional, inspirador
- **Elementos:** Misión, valores, diferenciador
- **Largo:** 100-200 palabras

### 8. Post interactivo
- **Uso:** Engagement, preguntas, encuestas
- **Tono:** Conversacional
- **Elementos:** Pregunta directa, opciones
- **Largo:** 30-80 palabras

## Reglas de generación

### Idioma
- Todo contenido en español
- Estilo Puerto Rico (no usar modismos de otros países)
- Usar "usted" en contenido formal, pero permitir tono casual en posts de redes

### Límites por plataforma

| Plataforma | Límite de caracteres | Hashtags recomendados |
|------------|---------------------|----------------------|
| Twitter/X | 280 | 2-3 |
| Instagram | 2,200 | 10-15 |
| Facebook | 63,206 | 3-5 |
| LinkedIn | 3,000 | 3-5 |
| TikTok | 2,200 | 3-5 |
| Threads | 500 | 3-5 |
| Bluesky | 300 | 2-3 |
| Pinterest | 500 (descripción) | 0 (usar keywords) |
| Google Business | 1,500 | 0 |

### Emojis
- Usar con moderación (1-3 por post)
- Apropiados para el tipo de negocio
- No usar en contenido formal/corporativo

### CTA (Call to Action)
Cada post debe terminar con una llamada a acción clara:
- "Visite nuestro local en [dirección]"
- "Llame al [teléfono]"
- "Escriba por DM para más información"
- "Visite [enlace]"
- "Aproveche esta oferta antes de [fecha]"

## Estructura del request

```json
{
  "business_name": "Panadería Don José",
  "business_type": "restaurante",
  "post_type": "oferta",
  "objective": "Vender pan de agua fresco",
  "details": "Descuento 20% en pan de agua los viernes",
  "platforms": ["instagram", "facebook"],
  "tone": "casual",
  "include_hashtags": true
}
```

## Estructura del response

```json
{
  "content": {
    "text": "🍞 ¡Viernes de pan fresco! ...",
    "hashtags": ["#PanDeAgua", "#PanaderíaPR", "#CompraPR"],
    "platform_versions": {
      "instagram": "🍞 ¡Viernes de pan fresco! ... #PanDeAgua #PanaderíaPR ...",
      "facebook": "🍞 ¡Viernes de pan fresco! ..."
    }
  },
  "metadata": {
    "post_type": "oferta",
    "char_count": { "instagram": 245, "facebook": 180 },
    "estimated_cost": 0.01
  }
}
```

## Integración con el sistema

El content-writer es llamado por el cerebro (route.ts) cuando:
1. Un plan ha sido aprobado y necesita generar contenido
2. El cliente pide "generar" o "crear" contenido para un post específico
3. El strategy-engine necesita contenido para ejecutar un plan

## Dependencias

| Skill | Para qué lo necesita |
|-------|---------------------|
| `pioneer-core` | Personalidad y tono |
| `strategy-engine` | Tipo de plan y acciones |
| `image-generator` | Complementar con imágenes (futuro - Fase C) |

## Costos

- Cada generación de texto usa Claude API
- Costo real: ~$0.002 por generación
- Cobra Pioneer: $0.01 por generación (markup 500%)
