/**
 * source.js — SourceFile and offset ↔ line/column mapping.
 * 
 * Fornece:
 * - Mapa offset → linha/coluna (1-based)
 - Mapeamento #line para includes virtuais
 * - Métodos de utilidade para navegação no código
 */

export class SourceFile {
  /**
   * @param {string} text - O texto completo do arquivo-fonte
   * @param {string} name - Nome do arquivo (para mensagens de erro)
   */
  constructor(text, name = 'main.cpp') {
    this.text = text;
    this.name = name;
    this._lineMap = this._buildLineMap();
  }

  _buildLineMap() {
    // Para CADA offset do texto (0..length), qual é o número da linha (1-based).
    // A versão anterior só preenchia os índices dos '\n', então offsetToLoc()
    // caía no `|| 1` e devolvia linha 1 para todo texto depois da primeira linha.
    const map = new Array(this.text.length + 1);
    let line = 1;
    for (let i = 0; i <= this.text.length; i++) {
      map[i] = line;
      if (this.text[i] === '\n') line++;
    }
    return map;
  }

  /**
   * Converter offset (posição no texto, 0-based) para {linha, coluna} (1-based).
   * @param {number} offset - Offset no texto
   * @returns {{line: number, column: number}}
   */
  offsetToLoc(offset) {
    if (offset < 0 || offset > this.text.length) {
      return { line: 0, column: 0 };
    }

    const line = this._lineMap[offset] || 1;
    // Início da linha: último '\n' estritamente antes do offset.
    // `lastIndexOf('\n', -1)` conta a partir do FIM da string, então não pode
    // ser usado quando offset = 0 — daí a busca linear explícita.
    let lineStart = 0;
    for (let i = offset - 1; i >= 0; i--) {
      if (this.text[i] === '\n') { lineStart = i + 1; break; }
    }
    const column = offset - lineStart + 1;
    return { line, column };
  }

  /**
   * Converter {linha, coluna} (1-based) para offset.
   * @param {number} line - Número da linha (1-based)
   * @param {number} column - Coluna (1-based)
   * @returns {number} Offset no texto
   */
  locToOffset(line, column) {
    // Encontra o início da linha (1-based)
    let offset = 0;
    for (let i = 1; i < line; i++) {
      const nl = this.text.indexOf('\n', offset);
      if (nl === -1) break;
      offset = nl + 1;
    }
    
    // Ajusta para a coluna desejada
    return offset + column - 1;
  }

  /**
   * Retorna a linha completa (1-based).
   * @param {number} line - Número da linha (1-based)
   * @returns {string} Conteúdo da linha
   */
  getLine(line) {
    const lines = this.text.split('\n');
    return lines[line - 1] || '';
  }

  /**
   * Retorna o número total de linhas.
   * @returns {number}
   */
  get lineCount() {
    return this._lineMap.length;
  }

  /**
   * Retorna um substring ao redor do offset, útil para code frames.
   * @param {number} offset - Offset central
   * @param {number} before - Caracteres antes do offset
   * @param {number} after - Caracteres após o offset
   * @returns {string}
   */
  snippet(offset, before = 30, after = 30) {
    const start = Math.max(0, offset - before);
    const end = Math.min(this.text.length, offset + after);
    const prefix = ' '.repeat(offset - start);
    return `${this.text.slice(start, end)}\n${' '.repeat(offset - start)}^`;
  }
}