# Strategy Engine Skill

## Descripción

Este skill es el motor estratégico de Pioneer. Recibe los objetivos del cliente y genera planes de marketing personalizados con acciones específicas, costos estimados y cronogramas.

## Archivos de este skill

| Archivo | Propósito |
|---------|-----------|
| `SKILL.md` | Este archivo - lógica del motor estratégico |
| `templates/` | Templates de planes por tipo de objetivo |

## Cómo funciona

```
Objetivo del cliente
        ↓
Clasificar tipo de objetivo
        ↓
Verificar información del negocio (business profile)
        ↓
Verificar balance del cliente
        ↓
Seleccionar canales apropiados
        ↓
Generar plan con acciones, costos y cronograma
        ↓
Presentar al cliente para aprobación
```

## Tipos de objetivos soportados

### 1. Aumentar ventas / Liquidar inventario
**Señales del cliente:** "quiero vender más", "tengo mucho inventario", "necesito mover producto"

**Canales recomendados:**
- Redes sociales: Posts con ofertas + Stories con urgencia
- Email: Campaña de ofertas a contactos existentes
- Anuncios: Meta Ads con público similar (lookalike)

**Ejemplo de plan:**
```
📋 Plan: Campaña de Liquidación

Duración: 7 días
Canales: Facebook, Instagram, Email

Acciones:
1. Crear 3 posts con fotos del producto y descuento (Día 1)
2. Publicar 1 post diario durante 7 días
3. Crear campaña de email a lista de contactos (Día 1)
4. Opcional: Boost de $10/día en Meta Ads

Costo estimado:
- Generación de contenido: $0.15
- Publicación en redes: $0.00 (incluido en suscripción)
- Email campaign: $0.10
- Meta Ads (opcional): $70.00
- Total sin ads: $0.25
- Total con ads: $70.25

¿Desea aprobar este plan?
```

### 2. Conseguir más clientes
**Señales del cliente:** "quiero más clientes", "necesito crecer", "quiero expandirme"

**Canales recomendados:**
- Redes sociales: Contenido educativo + testimonios
- Google Ads: Búsquedas locales relacionadas
- Landing page: Página de captación con oferta especial

**Ejemplo de plan:**
```
📋 Plan: Captación de Nuevos Clientes

Duración: 30 días
Canales: Facebook, Instagram, Google

Acciones:
1. Crear 8 posts de contenido (2 por semana)
   - 2 posts educativos sobre su industria
   - 2 posts de testimonios/resultados
   - 2 posts de ofertas para nuevos clientes
   - 2 posts de "detrás de escenas"
2. Publicar según calendario optimizado
3. Opcional: Google Ads para búsquedas locales

Costo estimado:
- Generación de contenido (8 posts): $1.20
- Imágenes AI (8 imágenes): $0.12
- Publicación en redes: $0.00
- Google Ads (opcional): $150.00
- Total sin ads: $1.32
- Total con ads: $151.32

¿Desea aprobar este plan?
```

### 3. Aumentar seguidores en redes sociales
**Señales del cliente:** "quiero más seguidores", "mi página no crece", "quiero presencia en redes"

**Canales recomendados:**
- Redes sociales: Contenido viral + constancia
- Hashtags estratégicos
- Colaboraciones sugeridas

**Ejemplo de plan:**
```
📋 Plan: Crecimiento en Redes Sociales

Duración: 30 días
Canales: Instagram, Facebook, TikTok

Acciones:
1. Crear calendario de 12 posts (3 por semana)
   - Mix de formatos: imágenes, carruseles, videos cortos
2. Investigar y usar hashtags relevantes
3. Publicar en horarios óptimos para PR
4. Responder comentarios y engagement

Costo estimado:
- Generación de contenido (12 posts): $1.80
- Imágenes AI (12 imágenes): $0.18
- Publicación en redes: $0.00
- Total: $1.98

¿Desea aprobar este plan?
```

### 4. Promocionar producto/servicio específico
**Señales del cliente:** "quiero promocionar X", "tengo un producto nuevo", "lanzo un servicio"

**Canales recomendados:**
- Redes sociales: Posts de lanzamiento + Stories
- Email: Anuncio a contactos existentes
- Landing page: Página dedicada al producto
- Anuncios: Meta y/o Google Ads

### 5. Aumentar visitas al local
**Señales del cliente:** "quiero más gente en mi local", "el local está vacío", "necesito tráfico"

**Canales recomendados:**
- Google Business: Optimizar perfil
- Redes sociales: Contenido local + ubicación
- Google Ads: Búsquedas locales
- Ofertas: Cupones para visitas presenciales

### 6. Branding / Dar a conocer el negocio
**Señales del cliente:** "nadie me conoce", "quiero darme a conocer", "soy nuevo"

**Canales recomendados:**
- Redes sociales: Contenido de identidad de marca
- Email: Newsletter informativo
- Landing page: Página principal del negocio

## Reglas para generar planes

### Obligatorio en cada plan:
1. **Nombre del plan** - Título descriptivo
2. **Duración** - Cuántos días/semanas
3. **Canales** - Qué plataformas se usarán
4. **Acciones numeradas** - Pasos específicos
5. **Costo estimado** - Desglosado por servicio
6. **Separar orgánico de pagado** - Siempre mostrar opción sin ads

### Reglas de costos:
- Usar precios con markup del 500%
- Imagen FLUX schnell: $0.015 por imagen
- Imagen FLUX pro: $0.275 por imagen
- Texto (Claude): $0.01 por generación
- Email (Brevo): $0.005 por email
- Publicación social: Incluido en suscripción
- Siempre mostrar total con y sin anuncios pagados

### Reglas de canales:
- Solo proponer canales que el cliente tenga conectados
- Si no tiene ningún canal, sugerir conectar primero
- Priorizar canales donde el cliente ya tiene audiencia
- Para negocios locales en PR, priorizar: Facebook > Instagram > Google

### Reglas de contenido:
- Todo contenido en español
- Adaptado al tipo de negocio del cliente
- Respetar las restricciones de `prohibited.md`
- Incluir llamadas a la acción claras

## Horarios óptimos para Puerto Rico

| Día | Mejor horario | Segundo mejor |
|-----|---------------|---------------|
| Lunes | 12:00 PM | 7:00 PM |
| Martes | 12:00 PM | 7:00 PM |
| Miércoles | 12:00 PM | 7:00 PM |
| Jueves | 12:00 PM | 7:00 PM |
| Viernes | 12:00 PM | 5:00 PM |
| Sábado | 10:00 AM | 1:00 PM |
| Domingo | 10:00 AM | 1:00 PM |

*Nota: Estos horarios son iniciales. Con datos de analytics se optimizarán por cliente.*

## Integración con el sistema

### Datos que necesita del cliente:
```json
{
  "business_name": "string",
  "business_type": "string",
  "connected_platforms": ["facebook", "instagram"],
  "objectives": ["más clientes"],
  "balance": 50.00,
  "previous_campaigns": []
}
```

### Estructura del plan generado:
```json
{
  "plan_name": "Campaña de Captación",
  "duration_days": 30,
  "channels": ["facebook", "instagram"],
  "actions": [
    {
      "order": 1,
      "type": "content_creation",
      "description": "Crear 8 posts con imágenes",
      "day": 1,
      "estimated_cost": 1.32
    }
  ],
  "total_cost_organic": 1.32,
  "total_cost_with_ads": 151.32,
  "status": "pending_approval"
}
```

## Dependencias

| Skill | Para qué lo necesita |
|-------|---------------------|
| `pioneer-core` | Personalidad y reglas de comportamiento |
| `business-memory` | Datos del negocio y historial (futuro) |
| `content-writer` | Generar textos de los posts (futuro) |
| `image-generator` | Crear imágenes para posts (futuro) |

## Notas para desarrollo

El strategy-engine actualmente funciona como parte del system prompt de Claude. En el futuro, cuando se implementen los skills de ejecución (social-media, email-campaigns, etc.), el plan generado aquí se convertirá en acciones ejecutables automáticamente.
