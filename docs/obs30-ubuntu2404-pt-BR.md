# OBS 30 + Web Remote legado no Ubuntu 24.04

[Read this guide in English](obs30-ubuntu2404.md).

Testado com OBS Studio `30.0.2+dfsg-3build1` e `obs-websocket-compat` `4.9.1` no Ubuntu 24.04 (amd64). Este [cliente](https://github.com/dvangennip/web_remote_for_OBS) usa o protocolo WebSocket **v4**; o servidor integrado do OBS 30, na porta `4455`, usa **v5**. É necessário um servidor v4 separado. Este guia não adiciona suporte a v5 ao cliente.

## 1. Instale o plugin de compatibilidade v4

Baixe o `.deb` **4.9.1-compat Qt6 para Ubuntu 64 bits** na página de [releases oficiais do obs-websocket](https://github.com/obsproject/obs-websocket/releases#release-4.9.1-compat). Na pasta do download, confira o nome do arquivo e execute:

```bash
sudo apt install ./obs-websocket-4.9.1-compat-Qt6-Ubuntu64.deb
```

O pacote Ubuntu dessa release foi compilado para uma versão anterior da distribuição; outras instalações podem exigir uma solução diferente.

## 2. Corrija o caminho se o OBS não carregar o plugin

Reinicie o OBS e procure as configurações separadas do WebSocket legado em **Ferramentas**. Se não aparecerem, confira o arquivo instalado:

```bash
dpkg -L obs-websocket-compat | grep '\.so$'
```

No sistema testado, ele estava em `/usr/obs-plugins/64bit/obs-websocket-compat.so`, fora do diretório utilizado pelos plugins do OBS da distribuição. **Feche o OBS** e crie um link na pasta de plugins do seu usuário:

```bash
mkdir -p "$HOME/.config/obs-studio/plugins/obs-websocket-compat/bin/64bit"
ln -s /usr/obs-plugins/64bit/obs-websocket-compat.so \
  "$HOME/.config/obs-studio/plugins/obs-websocket-compat/bin/64bit/obs-websocket-compat.so"
```

Se `dpkg -L` mostrar outro caminho, ajuste a origem do link. Não sobrescreva um destino existente. Reinicie o OBS. Caso o menu legado ainda não apareça, procure erros de carregamento ou bibliotecas ausentes no log atual; o link não corrige um binário incompatível.

## 3. Conecte o cliente

Ative o servidor WebSocket **legado/compat** no OBS, defina sua senha e confira a porta (geralmente `4444`). Não use o servidor v5 integrado na porta `4455`.

Na pasta que contém o `index.html` do cliente, sirva os arquivos:

```bash
python3 -m http.server 8000
```

Abra `http://localhost:8000/` e informe o IP do computador com OBS e a porta **legada**, por exemplo `192.168.15.71:4444`, além da senha desse servidor. Substitua o IP de exemplo pelo seu. Nesta configuração local via HTTP, use `ws://` em vez de `wss://`, a menos que tenha configurado TLS separadamente. Uma página aberta via HTTPS pode bloquear conexões `ws://`.

## Se não conectar

```bash
ss -ltnp | grep -E ':(4444|4455)\b'
```

- Só `4455` aparece: confira se o plugin compat carregou e se o servidor separado está ativado.
- O log mostra `pre-5.0.0 protocol` / `4010`: o cliente v4 está conectado ao servidor v5; use a porta legada.
- O menu legado não aparece: no OBS, abra **Ajuda → Arquivos de log → Exibir log atual** e procure erros de carregamento de `obs-websocket-compat`.

Não exponha à internet um servidor WebSocket do OBS sem autenticação. Os caminhos acima correspondem a uma instalação testada, não a todas as instalações Ubuntu.