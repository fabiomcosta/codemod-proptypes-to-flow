import annotateConstructor from '../helpers/annotateConstructor';
import createTypeAlias from '../helpers/createTypeAlias';
import findIndex from '../helpers/findIndex';
import findParentBody from '../helpers/findParentBody';
import transformProperties from '../helpers/transformProperties';
import ReactUtils from '../helpers/ReactUtils';

const isStaticPropType = p => {
  return (
    p.type === 'ClassProperty' &&
    p.static &&
    p.key.type === 'Identifier' &&
    p.key.name === 'propTypes'
  );
};

function hasFlowAnnotation(classDeclaration) {
  return classDeclaration.value.superTypeParameters != null;
}

function addSuperTypePropParameter(j, classDeclaration, genericTypeName) {
  j(classDeclaration).replaceWith({
    ...classDeclaration.node,
    superTypeParameters: j.typeParameterInstantiation([
      j.genericTypeAnnotation(j.identifier(genericTypeName), null)
    ])
  });
}

/**
 * Transforms es2016 components
 * @return true if any components were transformed.
 */
export default function transformEs6Classes(ast, j) {
  const reactUtils = ReactUtils(j);

  const classNamesWithPropsOutside = [];

  // NOTE: reactUtils.findReactES6ClassDeclaration(ast) is missing extends
  // for local imported components... If finding all classes is too greety,
  // we might combine findReactES6ClassDeclaration with classes that have a
  // render method.
  // const reactClassPaths = ast.find(j.ClassDeclaration);
  const reactClassPaths = reactUtils.findReactES6ClassDeclaration(ast);

  // find classes with propType static class property
  const modifications = reactClassPaths
    .forEach(p => {
      const className = reactUtils.getComponentName(p);
      const propIdentifier = reactClassPaths.length === 1
        ? 'Props'
        : `${className}Props`;
      let properties;

      if (hasFlowAnnotation(p)) {
        return;
      }

      addSuperTypePropParameter(j, p, propIdentifier);

      const classBody = p.value.body && p.value.body.body;

      if (classBody) {

        annotateConstructor(j, classBody, propIdentifier);

        const index = findIndex(classBody, isStaticPropType);

        if (typeof index !== 'undefined') {
          const classProperty = classBody.splice(index, 1).pop();
          properties = classProperty.value.properties;
        } else {
          // look for propTypes defined elsewhere
          classNamesWithPropsOutside.push(className);

          ast
            .find(j.AssignmentExpression, {
              left: {
                type: 'MemberExpression',
                object: {
                  name: className,
                },
                property: {
                  name: 'propTypes',
                },
              },
              right: {
                type: 'ObjectExpression',
              },
            })
            .forEach(p => {
              // this should only be one?
              properties = p.value.right.properties;
            })
            .remove();
        }

        properties = properties || [];

        const typeAlias = createTypeAlias(
          j,
          transformProperties(j, properties),
          {
            name: propIdentifier,
            shouldExport: false,
          }
        );

        // Find location to put propTypes flowtype definition
        // This will place ahead of class def
        const { child, body } = findParentBody(p);
        if (body && child) {
          const bodyIndex = findIndex(body.value, b => b === child);
          if (bodyIndex) {
            body.value.splice(bodyIndex, 0, typeAlias);
          }
        }
      }

    })
    .size();

  ast
    .find(j.ExpressionStatement, {
      expression: {
        type: 'AssignmentExpression',
        left: {
          type: 'MemberExpression',
          property: {
            name: 'propTypes',
          },
        },
        right: {
          type: 'ObjectExpression',
        },
      },
    })
    .filter(
      p =>
        classNamesWithPropsOutside.indexOf(
          p.value.expression.left.object.name
        ) > -1
    )
    .remove();

  return modifications > 0;
}
