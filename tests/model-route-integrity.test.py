"""The retry proxy must keep the user's selected model unless explicitly opted in."""
import ast
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch

class ModelRouteIntegrity(unittest.TestCase):
    def test_cross_model_fallback_is_disabled_for_every_model_by_default(self):
        source=(Path(__file__).resolve().parents[1]/'proxy/mm-retry-proxy.py').read_text()
        tree=ast.parse(source)
        cls=next(n for n in tree.body if isinstance(n,ast.ClassDef) and any(isinstance(m,ast.FunctionDef) and m.name=='refusal_target' for m in n.body))
        method=next(n for n in cls.body if isinstance(n,ast.FunctionDef) and n.name=='refusal_target')
        env={'os':os,'json':json,'GENERIC_FALLBACK':'other-model'}
        exec(compile(ast.Module(body=[method],type_ignores=[]),'proxy-fallback','exec'),env)
        with patch.dict(os.environ,{},clear=True):
            for model in ['gpt-6.1-sol','gpt-6-astra','gemini-3.8-flash-tiered','claude-opus-5-5','unknown']:
                self.assertIsNone(env['refusal_target'](object(),'another-model',json.dumps({'model':model})))
        with patch.dict(os.environ,{'UR_ALLOW_MODEL_FALLBACK':'1'}):
            self.assertEqual(env['refusal_target'](object(),'another-model',json.dumps({'model':'gpt-6.1-sol'})),'another-model')

if __name__=='__main__':unittest.main()
