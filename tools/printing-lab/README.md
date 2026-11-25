# Laboratorio Epson virtual

Este laboratorio envía trabajos de un entorno Supabase a emuladores ESC/POS
locales. No es BPrint ni certifica impresoras físicas.

## Requisitos y seguridad

- BPrint debe estar cerrado para que el laboratorio pueda adquirir los leases.
- Usa un proyecto Supabase de pruebas con impresoras provisionadas allí. El
  script rechaza el proyecto de producción por defecto; `-AllowProduction` es una
  opción explícita y se debe evitar para pruebas normales.
- El script necesita PowerShell 7 para leer `connection.dat`, que está protegido
  por DPAPI para el usuario actual. Ejecutarlo desde otra cuenta Windows falla.
- Los datos de impresoras deben corresponder al mismo proyecto Supabase indicado.
- `Ctrl+C` detiene también los procesos ocultos de los emuladores que inició el
  laboratorio.

## Preparación

1. Inicia sesión y provisiona dispositivos en BPrint apuntando a un proyecto de
   pruebas.
2. Crea los puntos/formatos/flujos en ese mismo proyecto y encola un evento.
3. Cierra BPrint antes de iniciar el laboratorio.
4. Ejecuta el script:

```powershell
pwsh -NoProfile -File .\tools\printing-lab\epson-print-lab.ps1 `
  -SupabaseUrl "https://TU_PROYECTO_DE_PRUEBAS.supabase.co" `
  -PublishableKey "TU_CLAVE_PUBLICA_DE_PRUEBAS"
```

El script empareja colas locales con dispositivos mediante `hardware_key`, crea
un emulador TCP por impresora y ejecuta el contrato batch actual
`operate_printing_batch(p_devices,p_results,p_instance_id)`. Los bytes recibidos
quedan en `output/<modelo>-<puerto>/`.

La salida solo demuestra que el agente envió bytes ESC/POS a un socket TCP. No
prueba alimentación de papel, corte, sensores, buffering ni recuperación física.
