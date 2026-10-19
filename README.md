# Els meus Rodalies

App web per veure, des del mòbil, els trens de Rodalies entre **Vila-seca** i **Barcelona-Passeig de Gràcia** (en els dos sentits):

- **Tauler (pàgina principal):** resum, trens movent-se en temps real pel diagrama de la línia, propers trens en els dos sentits, estat general de tota la xarxa de Rodalies i avisos.
- Retards en hores i minuts, trens cancel·lats o que no paren a l'estació.
- Enllaços als comptes de X de cada línia (@rod14cat, @rod15cat, @rod16cat).
- **Mapa del tren** (`mapa.html`): vista mòbil amb el mapa i la posició del tren seleccionat.

Funciona sense servidor: una tasca de GitHub Actions baixa les dades obertes de Renfe cada 5 minuts i publica el web a GitHub Pages.

## Posada en marxa (uns 5 minuts)

1. Crea un repositori nou a GitHub (pot ser públic, així els minuts d'Actions són gratuïts). Per exemple `rodalies`.
2. Puja-hi tot el contingut d'aquesta carpeta (incloent la carpeta oculta `.github`). Des del web de GitHub: *Add file → Upload files* i arrossega-hi els fitxers i carpetes.
3. Ves a **Settings → Pages** i a *Source* tria **GitHub Actions**.
4. Ves a la pestanya **Actions**, obre *Actualitza i publica* i prem **Run workflow**. La primera execució triga 1-2 minuts perquè baixa els horaris complets de Renfe.
5. Quan acabi, l'adreça de l'app surt a Settings → Pages (del tipus `https://<el-teu-usuari>.github.io/rodalies/`).
6. Al mòbil, obre l'adreça i fes *Afegeix a la pantalla d'inici* perquè quedi com una app.

## Com funciona

| Fitxer | Què fa |
| --- | --- |
| `config.json` | Estacions del trajecte i adreces de les dades de Renfe. |
| `scripts/build_schedule.py` | Un cop al dia baixa el GTFS de Renfe i guarda els trens que paren a les dues estacions (avui i demà). |
| `scripts/fetch_live.py` | Cada execució baixa retards, posicions i avisos en temps real i es queda només amb els dels teus trens. |
| `site/index.html`, `tauler.js`, `tauler.css` | El tauler principal. |
| `site/mapa.html`, `app.js`, `style.css` | La vista de mapa. |
| `site/core.js` | Lògica compartida: estat de cada tren, retards, format d'hores. |
| `.github/workflows/update.yml` | Executa els scripts cada 5 minuts i publica a GitHub Pages. |

Per canviar de trajecte, edita `config.json` amb els codis d'estació de Renfe (per exemple Cambrils és `65422`, Barcelona-Sants `71801`).

## Limitacions

- GitHub no garanteix l'hora exacta de les tasques programades: en hores punta de GitHub l'actualització pot arribar amb 10-15 minuts de retard. L'app sempre mostra l'hora de les dades.
- Els retards són els que publica Renfe: s'apliquen a la teva estació suposant que el tren manté el retard.
- Al diagrama, cada tren avança segons el seu horari desplaçat pel retard conegut; amb cada actualització de dades es recol·loca. Els trens sense dades en directe surten translúcids.
- En repositoris públics, GitHub atura les tasques programades després de 60 dies sense cap canvi al repositori. Si passa, només cal tornar a prémer *Run workflow* (o fer qualsevol canvi).
- Si Renfe deixa de servir dades a GitHub, la tasca ho indica als registres i l'app mostra només els horaris programats.
