const LATEX_COMMANDS = new Map([
    ['alpha', 'alpha'],
    ['beta', 'beta'],
    ['gamma', 'gamma'],
    ['delta', 'delta'],
    ['epsilon', 'epsilon'],
    ['theta', 'theta'],
    ['lambda', 'lambda'],
    ['mu', 'mu'],
    ['pi', 'pi'],
    ['rho', 'rho'],
    ['sigma', 'sigma'],
    ['tau', 'tau'],
    ['phi', 'phi'],
    ['omega', 'omega'],
    ['infty', 'infinity'],
    ['degree', 'degrees'],
    ['circ', 'degrees'],
    ['times', 'times'],
    ['cdot', 'times'],
    ['div', 'divided by'],
    ['pm', 'plus or minus'],
    ['mp', 'minus or plus'],
    ['leq', 'less than or equal to'],
    ['le', 'less than or equal to'],
    ['geq', 'greater than or equal to'],
    ['ge', 'greater than or equal to'],
    ['neq', 'not equal to'],
    ['ne', 'not equal to'],
    ['approx', 'approximately'],
    ['sim', 'approximately'],
    ['propto', 'proportional to'],
    ['therefore', 'therefore'],
    ['because', 'because'],
    ['rightarrow', 'goes to'],
    ['to', 'to'],
    ['leftarrow', 'from'],
    ['overrightarrow', 'vector'],
    ['vec', 'vector'],
    ['hat', 'hat'],
    ['bar', 'bar'],
    ['sin', 'sine'],
    ['cos', 'cosine'],
    ['tan', 'tangent'],
    ['log', 'log'],
    ['ln', 'natural log']
]);

const SYMBOL_REPLACEMENTS = [
    [/≤/g, ' less than or equal to '],
    [/≥/g, ' greater than or equal to '],
    [/≠/g, ' not equal to '],
    [/≈/g, ' approximately '],
    [/×/g, ' times '],
    [/÷/g, ' divided by '],
    [/±/g, ' plus or minus '],
    [/√/g, ' square root '],
    [/∞/g, ' infinity '],
    [/°/g, ' degrees '],
    [/→/g, ' goes to '],
    [/←/g, ' from '],
    [/−/g, ' minus ']
];

function expandLatexGroups(text) {
    let nextText = text;
    let previousText = '';

    while (nextText !== previousText) {
        previousText = nextText;
        nextText = nextText
            .replace(/\\(?:dfrac|tfrac|frac)\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, ' the fraction $1 over $2 ')
            .replace(/\\sqrt\s*\{([^{}]+)\}/g, ' square root of $1 ')
            .replace(/\\(?:vec|overrightarrow)\s*\{([^{}]+)\}/g, ' vector $1 ')
            .replace(/\\hat\s*\{([^{}]+)\}/g, ' $1 hat ')
            .replace(/\\bar\s*\{([^{}]+)\}/g, ' $1 bar ');
    }

    return nextText;
}

function replaceLatexCommands(text) {
    return text.replace(/\\([A-Za-z]+)\b/g, (match, command) => {
        if (command === 'left' || command === 'right') {
            return ' ';
        }

        return ` ${LATEX_COMMANDS.get(command) || command} `;
    });
}

function expandPowersAndSubscripts(text) {
    return text
        .replace(/([A-Za-z0-9)\]}]+)\s*\^\s*\{?2\}?/g, '$1 squared')
        .replace(/([A-Za-z0-9)\]}]+)\s*\^\s*\{?3\}?/g, '$1 cubed')
        .replace(/([A-Za-z0-9)\]}]+)\s*\^\s*\{?([^{}\s]+)\}?/g, '$1 to the power of $2')
        .replace(/([A-Za-z])\s*_\s*\{?([A-Za-z0-9]+)\}?/g, '$1 sub $2');
}

function expandMathOperators(text) {
    let nextText = text;

    for (const [pattern, replacement] of SYMBOL_REPLACEMENTS) {
        nextText = nextText.replace(pattern, replacement);
    }

    return nextText
        .replace(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/g, '$1 over $2')
        .replace(/(\d+(?:\.\d+)?)\s*%/g, '$1 percent')
        .replace(/([A-Za-z0-9)\]}])\s*=\s*([A-Za-z0-9({\[])/g, '$1 equals $2')
        .replace(/([A-Za-z0-9)\]}])\s*\+\s*([A-Za-z0-9({\[])/g, '$1 plus $2')
        .replace(/([A-Za-z0-9)\]}])\s*-\s*([A-Za-z0-9({\[])/g, '$1 minus $2')
        .replace(/(^|\s)-(\d+(?:\.\d+)?)/g, '$1negative $2');
}

export function normalizeForSpeech(text) {
    if (typeof text !== 'string') {
        return '';
    }

    let normalized = text
        .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, ' '))
        .replace(/\\\[/g, ' ')
        .replace(/\\\]/g, ' ')
        .replace(/\\\(/g, ' ')
        .replace(/\\\)/g, ' ')
        .replace(/\$\$/g, ' ')
        .replace(/\$/g, ' ')
        .replace(/\\begin\{[^{}]+\}/g, ' ')
        .replace(/\\end\{[^{}]+\}/g, ' ');

    normalized = expandLatexGroups(normalized);
    normalized = replaceLatexCommands(normalized);
    normalized = expandPowersAndSubscripts(normalized);
    normalized = expandMathOperators(normalized);

    return normalized
        .replace(/[{}]/g, ' ')
        .replace(/[_^]/g, ' ')
        .replace(/\s+([,.;:!?])/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
}
