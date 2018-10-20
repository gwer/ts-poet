import { imm, Imm } from "ts-imm";
import { CodeBlock } from "./CodeBlock";
import { CodeWriter } from "./CodeWriter";
import { DecoratorSpec } from "./DecoratorSpec";
import { FunctionSpec } from "./FunctionSpec";
import { Modifier } from "./Modifier";
import { ParameterSpec } from "./ParameterSpec";
import { PropertySpec } from "./PropertySpec";
import {TypeName, TypeNames, TypeVariable} from "./TypeNames";

/** A generated `class` declaration. */
export class ClassSpec extends Imm<ClassSpec> {

  public static create(name: string | TypeName): ClassSpec {
    return new ClassSpec({
      name: typeof name === 'string' ? name : name.reference(),
      javaDoc: CodeBlock.empty(),
      decorators: [],
      modifiers: [],
      typeVariables: [],
      superClassField: undefined,
      mixins: [],
      propertySpecs: [],
      constructorField: undefined,
      functionSpecs: [],
    });
  }

  @imm public readonly name!: string;
  @imm public readonly javaDoc!: CodeBlock;
  @imm public readonly decorators!: DecoratorSpec[];
  @imm public readonly modifiers!: Modifier[];
  @imm public readonly typeVariables!: TypeVariable[];
  @imm public readonly superClassField?: TypeName;
  @imm public readonly mixins!: TypeName[];
  @imm public readonly propertySpecs!: PropertySpec[];
  @imm public readonly constructorField?: FunctionSpec;
  @imm public readonly functionSpecs!: FunctionSpec[];

  public emit(codeWriter: CodeWriter): void {
    const constructorProperties: Map<string, PropertySpec> = this.constructorProperties();

    codeWriter.emitJavaDoc(this.javaDoc);
    codeWriter.emitDecorators(this.decorators, false);
    codeWriter.emitModifiers(this.modifiers, [Modifier.PUBLIC]);
    codeWriter.emit("class");
    codeWriter.emitCode(" %L", this.name);
    codeWriter.emitTypeVariables(this.typeVariables);

    const sc = this.superClassField ? CodeBlock.of("extends %T", this.superClassField) : CodeBlock.empty();
    const mixins = CodeBlock.joinToCode(
      this.mixins.map(it => CodeBlock.of("%T", it)), ", ", "implements ");
    if (sc.isNotEmpty() && mixins.isNotEmpty()) {
      codeWriter.emitCode(" %L %L", sc, mixins);
    } else if (sc.isNotEmpty() || mixins.isNotEmpty()) {
      codeWriter.emitCode(" %L%L", sc, mixins);
    }

    codeWriter.emit(" {\n");
    codeWriter.indent();

    // Non-static properties.
    this.propertySpecs.forEach(propertySpec => {
      if (!constructorProperties.has(propertySpec.name)) {
        codeWriter.emit("\n")
        propertySpec.emit(codeWriter, [Modifier.PUBLIC], true);
      }
    });

    // Write the constructor manually, allowing the replacement
    // of property specs with constructor parameters
    if (this.constructorField) {
      codeWriter.emit("\n");
      const it = this.constructorField;
      if (it.decorators.length > 0) {
        codeWriter.emit(" ");
        codeWriter.emitDecorators(it.decorators, true);
        codeWriter.emit("\n");
      }
      if (it.modifiers.length > 0) {
        codeWriter.emitModifiers(it.modifiers);
      }
      codeWriter.emit("constructor");

      let body = it.body;
      // Emit constructor parameters & property specs that can be replaced with parameters
      ParameterSpec.emitAll(it.parameters, codeWriter, true, it.restParameter, (param, isRest) => {
        let property = constructorProperties.get(param.name);
        if (property && !isRest) {
          // Ensure the parameter always has a modifier (that makes it a property in TS)
          if (!property.modifiers.find(m =>
            [Modifier.PUBLIC, Modifier.PRIVATE, Modifier.PROTECTED, Modifier.READONLY].includes(m)
          )) {
            // Add default public modifier
            property = property.addModifiers(Modifier.PUBLIC);
          }
          property.emit(codeWriter, [], false);
          param.emitDefaultValue(codeWriter);

          // Remove initializing statements
          body = body.remove(this.constructorPropertyInitSearch(property.name));
        } else {
          param.emit(codeWriter, true, isRest);
        }
      });

      codeWriter.emit(" {\n");
      codeWriter.indent();
      codeWriter.emitCodeBlock(body);
      codeWriter.unindent();
      codeWriter.emit("}\n");
    }

    // Constructors.
    this.functionSpecs.forEach(funSpec => {
      if (funSpec.isConstructor()) {
        codeWriter.emit("\n");
        funSpec.emit(codeWriter, this.name, [Modifier.PUBLIC]);
      }
    });

    // Functions (static and non-static).
    this.functionSpecs.forEach(funSpec => {
      if (!funSpec.isConstructor()) {
        codeWriter.emit("\n");
        funSpec.emit(codeWriter, this.name, [Modifier.PUBLIC]);
      }
    });

    codeWriter.unindent();

    if (!this.hasNoBody) {
      codeWriter.emit("\n");
    }
    codeWriter.emit("}\n");
  }

  public addJavadoc(format: string, ...args: any[]): this {
    return this.copy({
      javaDoc: this.javaDoc.add(format, ...args),
    });
  }

  public addJavadocBlock(block: CodeBlock): this {
    return this.copy({
      javaDoc: this.javaDoc.addCode(block),
    });
  }

  public addDecorators(...decoratorSpecs: DecoratorSpec[]): this {
    return this.copy({
      decorators: [...this.decorators, ...decoratorSpecs],
    });
  }

  public addDecorator(decoratorSpec: DecoratorSpec): this {
    return this.copy({
      decorators: [...this.decorators, decoratorSpec],
    });
  }

  public addModifiers(...modifiers: Modifier[]): this {
    return this.copy({
      modifiers: [...this.modifiers, ...modifiers],
    });
  }

  public addTypeVariables(...typeVariables: TypeVariable[]): this {
    return this.copy({
      typeVariables: [...this.typeVariables, ...typeVariables],
    });
  }

  public addTypeVariable(typeVariable: TypeVariable): this {
    return this.copy({
      typeVariables: [...this.typeVariables, typeVariable],
    });
  }

  public superClass(superClass: TypeName | string): this {
    // check(this.superClass == null) { "superclass already set to ${this.superClass}" }
    return this.copy({
      superClassField: TypeNames.anyTypeMaybeString(superClass),
    });
  }

  public addMixins(mixins: TypeName[]): this {
    return this.copy({
      mixins: [...this.mixins, ...mixins],
    });
  }

  public addMixin(mixin: TypeName | string): this {
    return this.copy({
      mixins: [...this.mixins, TypeNames.anyTypeMaybeString(mixin)],
    });
  }

  // "constructor" can't be a method name
  public cstr(constructor?: FunctionSpec): this {
    if (constructor) {
      // require(constructor.isConstructor) { "expected a constructor but was ${constructor.name}; use FunctionSpec.constructorBuilder when building"
    }
    return this.copy({
      constructorField: constructor,
    });
  }

  public addProperties(...propertySpecs: PropertySpec[]): this {
    return this.copy({
      propertySpecs: [...this.propertySpecs, ...propertySpecs],
    });
  }

  public addProperty(propertySpec: PropertySpec): this {
    return this.copy({
      propertySpecs: [...this.propertySpecs, propertySpec],
    });
  }

  public addProperty2(name: string, type: TypeName, optional: boolean = false, ...modifiers: Modifier[]): this {
    return this.addProperty(PropertySpec.create(name, type, optional, ...modifiers));
  }

  public addFunctions(...functionSpecs: FunctionSpec[]): this {
    functionSpecs.forEach(it => this.addFunction(it));
    return this;
  }

  public addFunction(functionSpec: FunctionSpec): this {
    // require(!functionSpec.isConstructor) { "Use the 'constructor' method for the constructor" }
    return this.copy({
      functionSpecs: [...this.functionSpecs, functionSpec],
    });
  }

  /** Returns the properties that can be declared inline as constructor parameters. */
  private constructorProperties(): Map<string, PropertySpec> {
    const cstr = this.constructorField;
    if (!cstr || !cstr.body) {
      return new Map();
    }
    const result: Map<string, PropertySpec> = new Map();
    this.propertySpecs.forEach(property => {
      const parameter = cstr.parameter(property.name);
      if (!parameter
        || parameter.type !== property.type
        || parameter.optional !== property.optional
        || property.initializerField !== undefined) {
        return;
      }
      const foundAssignment = cstr.body.formatParts.find(p =>
        p.match(this.constructorPropertyInitSearch(property.name)) !== null);
      if (!foundAssignment) {
        return;
      }
      result.set(property.name, property);
    });
    return result;
  }

  private constructorPropertyInitSearch(n: string): RegExp {
    // the outfoxx code was a lot fancier than this, but for now do the simple thing
    // and only match on standalone lines that are exactly `this.foo = foo` (we assume
    // any indentation and
    const pattern = `^this\\.${n}\\s*=\\s*${n}$`;
    return new RegExp(pattern);
  }

  private get hasNoBody(): boolean {
    if (this.propertySpecs.length > 0) {
      const constructorProperties = this.constructorProperties();
      const nonCstrProperties = this.propertySpecs.filter(p => !constructorProperties.has(p.name));
      if (nonCstrProperties.length > 0) {
        return false;
      }
    }
    return this.constructorField === undefined && this.functionSpecs.length === 0;
  }
}

