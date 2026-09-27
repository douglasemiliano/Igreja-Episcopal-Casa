import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ListarMembrosComponent } from './listar-membro.component';

describe('ListarMembrosComponent', () => {
  let component: ListarMembrosComponent;
  let fixture: ComponentFixture<ListarMembrosComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ListarMembrosComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ListarMembrosComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
