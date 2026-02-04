# Flujo de Onboarding

## Objetivo

Recolectar la información mínima necesaria para que Pioneer pueda ayudar efectivamente al cliente con su marketing digital.

## Cuándo activar onboarding

El onboarding se activa cuando:
1. Un usuario nuevo se registra en la plataforma
2. Un usuario existente no tiene perfil de negocio completo

## Formulario de registro

Pioneer debe presentar un formulario con los siguientes campos:

### Campo 1: Nombre del negocio
- **Tipo:** Texto libre
- **Requerido:** Sí
- **Placeholder:** "Ej: Panadería Don José"
- **Validación:** Mínimo 2 caracteres

### Campo 2: Tipo de negocio / Industria
- **Tipo:** Selección única (dropdown)
- **Requerido:** Sí
- **Opciones:**
  - Restaurante / Comida
  - Tienda / Retail
  - Servicios profesionales (abogado, contador, etc.)
  - Salud / Belleza
  - Automotriz
  - Otro (mostrar campo de texto si selecciona)

### Campo 3: Redes sociales actuales
- **Tipo:** Checkboxes con campos de URL opcionales
- **Requerido:** Al menos una
- **Opciones:**
  - [ ] Facebook → URL: ___________
  - [ ] Instagram → URL: ___________
  - [ ] TikTok → URL: ___________
  - [ ] LinkedIn → URL: ___________
  - [ ] Twitter/X → URL: ___________
  - [ ] YouTube → URL: ___________
  - [ ] Otra → Especificar: ___________ URL: ___________
  - [ ] No tengo redes sociales todavía

### Campo 4: Objetivos principales
- **Tipo:** Selección múltiple (checkboxes)
- **Requerido:** Al menos uno
- **Opciones:**
  - [ ] Aumentar ventas
  - [ ] Conseguir más clientes
  - [ ] Aumentar seguidores en redes sociales
  - [ ] Promocionar un producto/servicio específico
  - [ ] Aumentar visitas a mi local
  - [ ] Dar a conocer mi negocio (branding)
  - [ ] Otro (mostrar campo de texto si selecciona)

## Mensaje de introducción al formulario

```
"¡Bienvenido a Pioneer! 🎉

Para poder ayudarle de la mejor manera, necesito conocer un poco 
sobre su negocio. Por favor complete este breve formulario:

[FORMULARIO]

Esta información me ayudará a crear estrategias de marketing 
personalizadas para su negocio."
```

## Mensaje de confirmación

Después de completar el formulario:

```
"¡Excelente! Ya tengo todo lo que necesito para comenzar.

**Resumen de su negocio:**
- Nombre: [nombre]
- Industria: [industria]
- Redes sociales: [lista]
- Objetivos: [lista]

¿Está correcta esta información? Si desea cambiar algo, puede 
decirme qué actualizar.

Si todo está bien, cuénteme: ¿cuál es la primera meta que le 
gustaría lograr?"
```

## Validaciones

### Si el cliente no tiene redes sociales
```
"Noté que aún no tiene redes sociales para su negocio. ¡No hay problema!

Puedo ayudarle a definir en qué plataformas debería estar presente 
basándome en su tipo de negocio y objetivos.

¿Le gustaría que le recomiende por dónde empezar?"
```

### Si el cliente selecciona industria prohibida
Si el cliente intenta registrar un negocio de una categoría prohibida (ver `prohibited.md`), Pioneer debe rechazar educadamente:

```
"Lo siento, pero actualmente Pioneer no puede asistir a negocios 
en la categoría de [categoría]. 

Esto se debe a las políticas de las plataformas de publicidad y 
redes sociales con las que trabajamos.

Si tiene preguntas, puede contactarnos en info@pioneeragt.com."
```

## Datos a guardar

Después del onboarding, guardar en la base de datos:

```json
{
  "business_profile": {
    "name": "string",
    "industry": "string",
    "industry_other": "string | null",
    "social_accounts": [
      {
        "platform": "string",
        "url": "string | null",
        "connected": false
      }
    ],
    "objectives": ["string"],
    "objectives_other": "string | null",
    "onboarding_completed_at": "timestamp",
    "onboarding_version": "1.0"
  }
}
```

## Conectar redes sociales

Después del onboarding básico, Pioneer debe ofrecer conectar las redes sociales:

```
"Para poder publicar en sus redes sociales, necesito que las conecte 
a Pioneer. Esto es seguro y puede desconectarlas en cualquier momento.

¿Le gustaría conectar sus redes sociales ahora?

[Botón: Conectar redes sociales]
[Botón: Hacerlo después]"
```

## Flujo visual

```
┌─────────────────────────────────────┐
│     Usuario nuevo se registra       │
└─────────────────┬───────────────────┘
                  ↓
┌─────────────────────────────────────┐
│   Pioneer muestra bienvenida +      │
│         formulario                  │
└─────────────────┬───────────────────┘
                  ↓
┌─────────────────────────────────────┐
│   Usuario completa formulario       │
└─────────────────┬───────────────────┘
                  ↓
┌─────────────────────────────────────┐
│   Pioneer confirma información      │
└─────────────────┬───────────────────┘
                  ↓
┌─────────────────────────────────────┐
│   Pioneer ofrece conectar redes     │
└─────────────────┬───────────────────┘
                  ↓
┌─────────────────────────────────────┐
│   Usuario listo para usar Pioneer   │
└─────────────────────────────────────┘
```

## Notas de implementación

1. El formulario debe ser responsive (funcionar en móvil)
2. Guardar progreso parcial si el usuario no completa
3. Permitir editar información después del onboarding
4. Trackear tasa de completación del onboarding
5. Enviar email de bienvenida después del onboarding completo
