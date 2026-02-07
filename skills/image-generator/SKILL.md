# Image Generator Skill

## Descripción

Este skill permite a Pioneer generar imágenes con inteligencia artificial usando FLUX (via Replicate API) para acompañar publicaciones en redes sociales.

## Archivos de este skill

| Archivo | Propósito |
|---------|-----------|
| `SKILL.md` | Este archivo - documentación del skill |

## Cómo funciona

```
Cliente aprueba contenido de texto
        ↓
Pioneer pregunta si quiere imagen
        ↓
  ┌─────────┼──────────────┐
  ↓         ↓              ↓
Imagen AI  Foto propia   Sin imagen
  ↓         ↓              ↓
generate   (futuro)      Publicar
_image                   solo texto
  ↓
Mostrar imagen al cliente
        ↓
Cliente aprueba
        ↓
Publicar texto + imagen
```

## Modelos disponibles

| Modelo | Identificador | Costo real | Costo cliente | Velocidad | Uso |
|--------|--------------|-----------|---------------|-----------|-----|
| FLUX schnell | black-forest-labs/flux-schnell | $0.003/img | $0.015/img | ~1-4 seg | Posts diarios, default |
| FLUX 1.1 Pro | black-forest-labs/flux-1.1-pro | $0.055/img | $0.275/img | ~5-10 seg | Campañas premium |

Pioneer usa **schnell por defecto**. Solo usa Pro si el cliente pide explícitamente mejor calidad.

## Cuándo Pioneer debe ofrecer imagen

### SÍ ofrecer:
- Después de generar contenido de texto (siempre preguntar)
- Cuando el cliente pide una imagen directamente
- Cuando un plan incluye "crear contenido visual"

### NO ofrecer:
- Si el cliente ya dijo que no quiere imagen
- Si el cliente va a subir su propia foto
- Posts de tipo interactivo (encuestas, preguntas) — texto suele ser suficiente

## Flujo de decisión para Pioneer

### Después de generar contenido de texto:
```
Pioneer: "He creado el contenido para su post:
[texto del post]

¿Desea acompañar este post con una imagen?
- Puedo generar una imagen con inteligencia artificial ($0.015)
- Puede enviarme una foto de su producto (próximamente)
- O puede publicar solo con texto"
```

### Si el cliente quiere imagen AI:
```
Pioneer: [usa generate_image]
"He generado esta imagen para su post:
🖼️ [URL de la imagen]

Aquí está su post completo:
📝 Texto: [contenido]
🖼️ Imagen: [URL]

¿Aprueba este contenido para publicar?"
```

### Si el cliente quiere su propia foto:
```
Pioneer: "¡Excelente idea! La función de subir fotos estará disponible 
próximamente. Por ahora, puedo generar una imagen AI o publicar solo 
con texto. ¿Qué prefiere?"
```

### Si el cliente pide imagen directamente:
```
Cliente: "Hazme una imagen de pan artesanal"

Pioneer: [usa generate_image]
"He generado esta imagen:
🖼️ [URL]

¿Desea que la publique en alguna de sus redes sociales?"
```

## Aspect ratios por plataforma

| Plataforma | Aspect Ratio | Razón |
|------------|-------------|-------|
| Instagram | 4:5 | Ocupa más pantalla en el feed |
| Facebook | 1:1 | Cuadrado funciona bien |
| Twitter/X | 16:9 | Landscape estándar |
| LinkedIn | 1:1 | Profesional |
| TikTok | 9:16 | Vertical |
| Pinterest | 2:3 | Vertical (más scroll) |
| YouTube | 16:9 | Landscape |

Si el post va a múltiples plataformas, usar **1:1** (funciona en todas).

## Prompts de imagen

FLUX funciona mejor con prompts en **inglés**, descriptivos y específicos. Pioneer debe generar el prompt internamente basándose en:

1. Tipo de negocio
2. Qué se está promocionando
3. Estilo visual deseado (foto realista, ilustración, diseño plano)

### Ejemplo de prompt generado:
```
"professional photograph, high quality, commercial photography, well-lit, 
fresh artisan bread with golden crust on a rustic wooden table, 
for a bakery, social media marketing image, vibrant, appetizing, inviting, 
no text overlay"
```

### Reglas para prompts:
- Siempre en inglés (FLUX entiende mejor)
- Incluir estilo visual (photograph, illustration, etc.)
- Describir el producto/servicio específicamente
- Agregar "no text overlay" — el texto va en el caption del post, no en la imagen
- Agregar "social media marketing image" para contexto
- Incluir adjetivos como "vibrant, inviting, professional"

## URLs temporales — IMPORTANTE

Las URLs de imágenes generadas por Replicate **expiran en 1 hora**.

### Para el MVP:
- Publicar inmediatamente después de aprobación → URL funciona
- Posts programados dentro de 1 hora → URL funciona

### Futuro (Fase F con Supabase):
- Descargar imagen de Replicate → subir a Supabase Storage → URL permanente
- Esto permitirá posts programados a cualquier hora e historial de imágenes

### Pioneer debe informar al cliente:
```
"Nota: La imagen estará disponible por 1 hora. Si aprueba el post, 
lo publicaré o programaré inmediatamente."
```

## Manejo de errores

| Error | Qué hacer |
|-------|-----------|
| Replicate API key inválida | Escalar a info@pioneeragt.com |
| Prompt genera contenido NSFW | Informar, pedir prompt diferente |
| Timeout (>60 seg) | Reintentar 1 vez, informar si falla |
| URL expirada al publicar | Regenerar imagen, pedir aprobación de nuevo |
| Rate limit | Esperar, reintentar |

## Dependencias

| Servicio | Para qué |
|----------|----------|
| Replicate API | Genera imágenes con FLUX |
| `content-writer` | Genera texto que la imagen acompaña |
| `social-publisher` | Publica imagen + texto en redes |

## Variables de entorno requeridas

```
REPLICATE_API_TOKEN=r8_...
```

## Costos

- FLUX schnell: $0.003/imagen real → $0.015/imagen al cliente (markup 500%)
- FLUX Pro: $0.055/imagen real → $0.275/imagen al cliente (markup 500%)
- Storage: Futuro — incluido en suscripción ($29/mes)
